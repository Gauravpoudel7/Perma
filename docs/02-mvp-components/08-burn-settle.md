# Component: Burn & Settle

> **Scope:** Fair MVP (Part A of [`PRD.md`](../../PRD.md)). 1-leg positions, one allowlisted market.
> **Accounting model:** range-scoped premium bucket, pro-rata by short liquidity. Decision and rejected alternatives in [ADR-0002](../adr/ADR-0002-premium-accounting.md). Formulas and constants in [`07-premium-engine.md`](07-premium-engine.md).

## Purpose

Handles closing a position and settling its final economics: streaming premium **and** P&L, with the actual token movements between user collateral and the range premium bucket.

## User-Facing Behavior

The user clicks "Close Position" and sees a settlement preview — P&L from the current price against their range, plus accrued premium (owed if long, earned if short). On confirm, the position closes and collateral updates. A short whose premium is not yet fully funded closes its liquidity and P&L immediately and shows "Premium pending" until the claim clears.

## Dependencies

- [CLMM Adapter](01-clmm-adapter-orca.md) — removes Whirlpool liquidity for shorts
- [Premium Engine](07-premium-engine.md) — index, accrual, and conversion math
- [Collateral Manager](03-collateral-manager.md) — USDC debits/credits and the range escrow
- [Position Engine](04-position-engine-1leg.md) — position status transitions
- [Risk & Solvency](09-risk-solvency.md) — P&L valuation

---

## A. The Premium Bucket

Premium does **not** move directly from one long to one short. Longs pay **into a range bucket**; shorts draw **out of it** in proportion to the liquidity they provided. This is what makes "one long, many shorts" well-defined.

`RangePremiumState` PDA — `["range", market, tick_lower_le, tick_upper_le]`:

| Field | Type | Meaning |
|---|---|---|
| `total_short_liquidity` | `u128` | Sum of all open short liquidity. **The pro-rata denominator.** |
| `total_long_liquidity` | `u128` | Sum of all open long liquidity. Drives entitlement accrual. |
| `acc_premium_per_short_q64` | `u128` | Cumulative µUSDC earned per unit of short liquidity, Q64.64 |
| `last_index` | `u128` | `GlobalPremiumIndex.current_index` at the last poke |
| `premium_pool` | `u64` | µUSDC actually escrowed and payable right now |
| `receivable` | `u64` | µUSDC earned by shorts but not yet funded by a long |
| `dust` | `u64` | Floor residue; belongs to nobody until the range unwinds |

**Escrow location:** `premium_pool` is real USDC held in a PDA-owned token account, `["range_vault", market, tick_lower_le, tick_upper_le]`, authority = `market_authority`. It is **not** a bookkeeping number against the shared collateral vault — keeping it separate is what makes the vault-conservation invariant checkable.

### Two clocks, deliberately separate

| | Driven by | Purpose |
|---|---|---|
| **Entitlement** (`acc_premium_per_short_q64`) | elapsed slots × `total_long_liquidity` | What shorts have *earned*, accrued in real time |
| **Cash** (`premium_pool`) | longs actually paying in | What can be *paid out* right now |

`receivable` is the gap between them. Accruing entitlement on elapsed time rather than on received cash is what protects a short who closes before any long has settled — see §F and ADR-0002.

---

## B. `poke_range` — advancing entitlement

```rust
fn poke_range(index: &GlobalPremiumIndex, market: &Market, r: &mut RangePremiumState) {
    let d_index = index.current_index - r.last_index;
    if d_index > 0 && r.total_long_liquidity > 0 && r.total_short_liquidity > 0 {
        // Total µUSDC all longs in this range owe for the elapsed period.
        let inflow = (d_index
            * r.total_long_liquidity
            * market.premium_multiplier as u128) / PREMIUM_SCALE;

        // Distribute pro-rata across short liquidity, Q64.64.
        r.acc_premium_per_short_q64 += (inflow << 64) / r.total_short_liquidity;
    }
    r.last_index = index.current_index;
}
```

> ⚠️ **Ordering rule.** `poke_range` must run **before** any change to `total_short_liquidity` or `total_long_liquidity`. The elapsed period has to be attributed at the weights that were in force during it. Poking after a mint or burn silently misallocates the whole period. Every flow below follows this order, and it is covered by vector **V4**.

A short's claim at any moment:

```rust
fn claimable(pos: &Position, r: &RangePremiumState) -> u64 {
    (((r.acc_premium_per_short_q64 - pos.entry_acc_q64) * pos.liquidity) >> 64) as u64
}
```

---

## C. `settle_premium(long)` — permissionless funding crank

Anyone may call this against any open long. It moves accrued premium from the long's collateral into the range bucket and rolls the long's checkpoints forward. It never closes the position.

```rust
fn settle_premium_long(ctx, pos: &mut Position, r: &mut RangePremiumState) -> Result<u64> {
    require!(pos.leg_type == LONG && pos.status == Open, PermaError::NothingToSettle);
    require!(r.key() == derive_range(pos), PermaError::RangeStateMismatch);

    premium_engine::update_index(ctx.index);        // always fresh first
    premium_engine::poke_range(ctx.index, ctx.market, r);
    premium_engine::accrue_long(ctx.index, ctx.market, pos);

    let payable = premium_engine::payable_from(pos);     // floor + carry
    require!(payable > 0, PermaError::NothingToSettle);

    // --- actual collateral movement ---
    collateral::debit_usdc(ctx.user_collateral, payable)?;       // long's balance -= payable
    token::transfer(ctx.collateral_vault, ctx.range_vault, payable)?;
    r.premium_pool += payable;

    // Pay down anything already owed to exited shorts, oldest claim first.
    let settled = min(r.receivable, r.premium_pool);
    r.receivable   -= settled;

    emit!(PremiumSettled { market, owner, perma_position, leg_type: LONG, amount: payable, still_owed: 0, premium_pool, premium_owed_usdc });
    Ok(payable)
}
```

Because premium is a liability counted by the solvency check ([`09-risk-solvency.md`](09-risk-solvency.md)), `debit_usdc` is expected to succeed. If it cannot, the long is already insolvent — see §G.

**Who calls it, given there is no reward?** Shorts do, in their own interest: cranking the longs in your range is how you fund your own claim before you close. That self-interest is the incentive, which is why the poke bounty is zero.

## D. `settle_premium(short)` — claiming

```rust
fn settle_premium_short(ctx, pos: &mut Position, r: &mut RangePremiumState) -> Result<u64> {
    require!(pos.leg_type == SHORT, PermaError::NothingToSettle);
    require!(r.key() == derive_range(pos), PermaError::RangeStateMismatch);

    premium_engine::update_index(ctx.index);
    premium_engine::poke_range(ctx.index, ctx.market, r);

    let earned = claimable(pos, r);                 // floor
    pos.entry_acc_q64 = r.acc_premium_per_short_q64;    // roll forward

    let owed = earned + pos.premium_receivable;
    let paid = min(owed, r.premium_pool);

    r.premium_pool         -= paid;
    pos.premium_receivable  = owed - paid;          // unfunded remainder, if any
    r.receivable           += pos.premium_receivable;

    if paid > 0 {
        token::transfer(ctx.range_vault, ctx.collateral_vault, paid)?;
        collateral::credit_usdc(ctx.user_collateral, paid)?;     // short's balance += paid
    }

    // A short that was only waiting on premium can now finish closing.
    if pos.status == PendingPremium && pos.premium_receivable == 0 {
        pos.status = Closed;
        close_position_account(pos, ctx.owner);                  // rent refunded
    }
    Ok(paid)
}
```

---

## E. Burn paths

### E.1 `burn_position(long)`

```rust
fn burn_long_inner(ctx) {
    require!(pos.status == Open, PermaError::PositionAlreadyClosed);

    // 1. Settle premium in full, IN CASH — debit free USDC, transfer vault_b → range_vault,
    //    premium_pool += payable. If free USDC cannot cover it: InsufficientCollateralForLoss,
    //    the whole tx reverts, the position stays Open (§G). Never clear without transfer.
    if payable > 0 { pay_long_premium_cash(ctx, payable)?; }

    // 2. Close the books. P&L = 0.
    position::close_long(pos)?;

    // 3. Release this long's claim on short inventory (poke already ran in the shared prefix).
    r.total_long_liquidity -= pos.liquidity;      // available_short_liquidity() is derived, never stored

    emit!(LongBurned { owner, size, premium_paid_usdc, total_long_liquidity, available_after });
    // 4. Rent back to the owner.
}
```

> **P&L is 0 on long burn — by decision, not omission** ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). An earlier draft of this section valued the long's intrinsic value "conservatively between spot and TWAP" and `credit_usdc`'d it. Two things were wrong with that: Orca Whirlpool has **no TWAP** (`orca_whirlpools_client` 8.0.0 exposes spot only), and a credit with **no counterparty prints USDC out of the shared collateral vault**. Long intrinsic value needs a funded counterparty — force-exercise against short collateral — which is Protocol V1.
>
> The long's premium leaves collateral **into the range vault**, not to a counterparty and not to the protocol. Applying `premium + pnl` as one lump double-counts premium and breaks zero-sum.

### E.2 `burn_position(short)`

```rust
fn burn_position(ctx) /* SHORT branch */ {
    require!(pos.status == Open, PermaError::PositionAlreadyClosed);

    // 1. Claim premium FIRST, while total_short_liquidity still includes this position.
    //    paid = min(claimable + premium_receivable, premium_pool); transfer range_vault → vault_b;
    //    credit_usdc(paid); the shortfall is carried on premium_receivable.
    let (claimed, still_owed) = claim_short_premium_cash(ctx)?;

    // 2. Orca 3-step close (decrease → collect → close). Vault deltas are measured around it.
    let (returned_a, returned_b) = remove_liquidity_for_short(..)?;

    // 3. Now drop out of the pro-rata denominator (poke already ran in the shared prefix).
    r.total_short_liquidity -= pos.liquidity;     // must leave >= total_long_liquidity, else InventoryInvariantViolated

    // 4. Release collateral and credit what Orca actually returned — this IS the realized LP result.
    //    locked -= what mint locked (spent);  free += returned.   returned − locked is the P&L,
    //    absorbed here exactly once. There is no separate P&L step.
    position::close_short(pos, user, &BurnOutcome { returned_a, returned_b })?;

    // 5. Status: Closed, or PendingPremium when premium_receivable > 0 (account survives to carry it).
    emit!(ShortBurned { owner, liquidity, unlocked_a, unlocked_b, returned_a, returned_b,
                        premium_claimed, premium_receivable, status, open_positions });
    if status == Closed { close the PDA, rent to owner }
}
```

> **There is no step "apply P&L" for a short — and adding one would be a bug.** An earlier draft of this section called `risk::calculate_pnl` after `close_short` and credited or debited the result. `close_short` already realizes the LP outcome by crediting `returned` and releasing `locked`; the difference *is* the realized P&L. A second apply double-counts it and breaks `vault + Σ in_orca == Σ(free + locked)`. `risk::calculate_pnl` does not exist ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).

Step 1 before step 2 is mandatory: claiming after the decrement would compute this short's share against a denominator it is no longer part of.

### `PendingPremium` status

A short in `PendingPremium` has **already** withdrawn its Orca liquidity and settled P&L. Only the premium claim is outstanding. The `Position` account stays alive solely to hold `premium_receivable` and `entry_acc_q64`; it stops accruing new entitlement because it is no longer in `total_short_liquidity`. Any later `settle_premium(short)` that clears the balance closes the account and refunds rent.

---

## F. Case matrix

| Case | Behavior |
|---|---|
| **Where premium goes on long burn** | Long's USDC → `range_vault`; `premium_pool += payable`. Not to a counterparty, not to the protocol. |
| **How much each short gets** | `floor((acc_now − entry_acc) × liquidity / 2^64)` — strictly pro-rata by liquidity provided, weighted by the time it was provided. |
| **Unequal sizes (A vs B)** | Shorts 3 M and 1 M over the same period split 3:1. Vector **V2**: A `74 999`, B `24 999`, dust `2`. |
| **Short joins late** | `entry_acc_q64` is set at mint, so it earns only from that point. Vector **V4**: A `174 999`, B `24 999`. |
| **Short closes before long settles** | Entitlement already accrued on elapsed time. `premium_pool` may be empty → `premium_receivable` recorded, status `PendingPremium`. Vector **V5**. |
| **Long closes before shorts** | Long pays in full at burn; `premium_pool` holds the cash. Shorts claim whenever they like — no deadline, no expiry on a claim. |
| **Long closes, no shorts left** | Cannot occur: `total_long ≤ total_short` is enforced at mint, so a short cannot exit below outstanding long liquidity. |
| **Dust residue** | Stays in the vault inside `premium_pool`, indistinguishable from unclaimed entitlement. The `dust` field is **declared but never written** (see §Test Cases and the 08 report residual #2). Not claimable by any position. |
| **Range fully unwinds** | **Not implemented.** No instruction closes a range or sweeps residue; there is no protocol fee account. When it exists, residue transfers out and `RangePremiumState` + `range_vault` close, rent to the closer — and that would be the only path by which the protocol receives any premium. |

---

## Invariants

1. **Zero-sum, zero skim** — for any range, `Σ long payments == Σ short claims + dust`. The protocol takes no cut while the range is live.
2. **Vault conservation** — `range_vault.balance == premium_pool + dust` at all times.
3. **Pool never negative** — every claim floors and is capped by `min(owed, premium_pool)`.
4. **Entitlement ≥ cash** — `Σ outstanding claims == receivable + (claims payable from premium_pool)`; entitlement may lead cash, never the reverse.
5. **Poke before weights** — no mutation of `total_short_liquidity` / `total_long_liquidity` without an immediately preceding `poke_range`.
6. **Premium applied once** — premium moves only via `settle_premium`; burn paths apply P&L only.
7. **Liquidity restore** — a short cannot reach `Closed` or `PendingPremium` without its Whirlpool liquidity being removed.
8. **No claim expiry** — a `PendingPremium` position is never force-closed or swept.

## Failure Modes & Errors

| Error | Trigger |
|---|---|
| `PositionAlreadyClosed` | Burning a `Closed` position |
| `NothingToSettle` | `settle_premium` with zero payable and zero outstanding claim |
| `RangeStateMismatch` | Passed `RangePremiumState` does not match the position's ticks |
| `InsufficientCollateralForLoss` | Long's `premium + loss` exceeds available collateral (§G) |
| `PremiumPoolUnderfunded` | Defensive: a claim exceeds `premium_pool + receivable` capacity — indicates an accounting bug, not a user condition |

### G. When a long cannot pay

Premium is a **senior claim**, settled before P&L. `settle_premium_long` debits premium first; if collateral cannot cover it, the burn fails with `InsufficientCollateralForLoss` and the position stays `Open`.

Component 09 makes this hard to reach: [`09-risk-solvency.md`](09-risk-solvency.md) counts `payable_if_settled_now + required_margin` over every open long on withdraw and long mint ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)), so a long cannot withdraw the USDC it will owe within the horizon. It remains reachable past the margin horizon — Fair MVP has **no liquidation** (explicitly a stretch goal in `PRD.md` §A2), so the honest MVP outcome is that the position stays open and the premium remains owed. Shorts hold `receivable` until it is paid. This is a known and accepted MVP limitation, recorded in ADR-0002 and ADR-0003.

## Security Notes

- **Atomic settlement** — liquidity removal, premium movement, and collateral updates occur in one transaction. A failed adapter CPI leaves the position `Open`.
- **Ordering** — invariant 5 is a security property, not a style rule: poking after a weight change lets a caller mint into a range and capture premium accrued before they arrived.
- **Re-entrancy** — all state is written before token transfers; the range vault is PDA-owned with `market_authority` as sole signer.
- **Permissionless crank safety** — `settle_premium(long)` is callable by anyone, which is safe only because of floor-with-carry rounding ([`07-premium-engine.md`](07-premium-engine.md) §C). It moves a user's money but only ever to the bucket they already owe, and never changes the total owed.
- **Precision** — P&L and premium use the same fixed-point conventions as the CLMM Adapter.

## Test Cases

Vectors referenced are in [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md) §5.

- [x] **V2 — 1 long + 2 unequal shorts.** 3 M / 1 M → `74 999` / `24 999`, dust `2`; assert `claims + dust == paid`. *(`premium.rs` unit test)*
- [x] **V3 — 1 long + 3 equal shorts.** `33 333` each, dust `1`. *(`premium.rs` unit test)*
- [x] **V4 — late join.** Short B joins at slot 100 → A `174 999`, B `24 999`. Assert B earns nothing for period 1. *(component 06)*
- [x] **V5 — short closes first.** Pool empty → `premium_receivable = 99 999`, status `PendingPremium`; long later settles; short claims and the account closes. *(unit test **and** `tests/settle-premium.ts` end-to-end)*
- [x] **Long closes first.** Pool holds cash; two shorts claim in either order with identical totals.
- [ ] **Dust accumulation.** *Partly.* `range_vault.amount == premium_pool + dust` is asserted after every settle path and reconciled over RPC — but `dust` is never written: the residue stays inside `premium_pool`, indistinguishable from unclaimed entitlement. Separating them needs the range-unwind path below.
- [ ] **Range unwind.** Not implemented. No instruction closes a range or sweeps residue; both would move funds with no user to attribute them to, which is a governance question this MVP does not answer.
- [x] **Ordering regression.** Poke *after* a weight change and assert the resulting split is wrong — guards invariant 5. *(component 06)*
- [x] **Double-settle.** Two settles cost a long exactly what one would, asserted to the µUSDC; a long below the µUSDC floor returns `NothingToSettle`. *(A second settle in the literal same slot is not reachable from a test client — the slot advances between RPCs — so the stronger frequency-neutrality property is asserted instead.)*
- [x] **Wrong range account.** `range_state` is seed-derived from the *position's* ticks and `range_vault` is derived in-handler → `RangeStateMismatch`. Enforced by construction rather than by a caller-supplied account.
- [ ] **Adapter failure.** Not added. The claim runs before the Orca CPI in one transaction, so a CPI failure reverts the premium transfer with it; forcing the failure needs a fault-injection harness this MVP has no way to build against a cloned Orca program.

## Observability & Events

```rust
PremiumSettled  { market, owner, perma_position, leg_type, amount, still_owed, premium_pool, premium_owed_usdc }   // every settle path; `amount` is USDC that moved
LongBurned      { market, owner, perma_position, size, premium_paid_usdc, total_long_liquidity, available_after }
ShortBurned     { market, owner, perma_position, liquidity, unlocked_a, unlocked_b, returned_a, returned_b, premium_claimed, premium_receivable, status, open_positions }
// RangeUnwound: not emitted — no range-unwind instruction exists (see §Test Cases).
```

## MVP Done Definition

- [x] `RangePremiumState` + `range_vault` implemented with the documented seeds.
- [x] `settle_premium` implemented for both legs; long path is permissionless.
- [x] Burn paths move premium via the bucket. **P&L is 0 — deferred to [component 09](09-risk-solvency.md)**, which still defines no valuation; `risk::calculate_pnl` does not exist. §E steps 3–4 are unimplemented on purpose rather than faked.
- [x] `poke_range` always precedes liquidity-weight changes.
- [x] `PendingPremium` status implemented, with rent refunded on final close.
- [x] Vectors V2–V5 pass, plus the ordering regression test.
- [x] Zero-sum and vault-conservation invariants asserted in tests, and reconciled from outside the program by `scripts/reconcile.mjs`.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
