# Component: Risk & Solvency (Fair MVP)

> **Status: SHIPPED (2026-09-20).** `risk.rs` counts accrued premium on every open long plus a horizon margin, on both `withdraw_collateral` and `mint_position(LONG)`; the `balance_b > 0` stub is gone. Decisions: [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md). Report: [`IMPL-09-RISK-SOLVENCY-REPORT.md`](../audits/IMPL-09-RISK-SOLVENCY-REPORT.md). Audit that preceded it: [`DOCS-SYNC-AUDIT-09.md`](../audits/DOCS-SYNC-AUDIT-09.md).

## Purpose

Stop a long from running away from its premium debt. That is the entire job. A long accrues premium every slot it is open; shorts are paid out of what longs actually settle. If a long can withdraw its free USDC before settling, the shorts in that range hold a `receivable` nobody funds — and Fair MVP has no liquidation to recover it. Component 09 makes that impossible by construction: **free USDC can never drop below what the user's open longs already owe plus a margin for what they will owe next.**

## What this component is not

- **Not a price-based risk engine.** Orca Whirlpool exposes spot `sqrt_price` / `tick_current_index` only. There is no observation array, no TWAP, and the `Oracle` PDA is adaptive-fee state. PERMA reads no price for solvency. Spot is used for tick-range gating in the adapter and for display.
- **Not P&L.** No `calculate_pnl` exists and none is added. A short's realized LP result is `returned − locked`, applied once by `position::close_short`. A long closes with P&L = 0; intrinsic value needs a funded counterparty (Protocol V1, force-exercise).
- **Not liquidation.** `PRD.md` §A2: stretch, not Fair. An underwater long stays open until its owner settles or deposits.
- **Not short margin.** A short's locked spend *is* its collateral; nothing here changes shorts.

## User-Facing Behavior

- Opening a long with too little free USDC fails with **`InsolventMint`** — "you need at least `required_margin(L)` on top of what your existing longs already owe".
- Withdrawing USDC that your open longs owe, or will owe over the next `long_margin_horizon_slots`, fails with **`InsolventWithdrawal`**.
- Withdrawing without listing all your open longs fails with **`MissingOpenLong`**; the client passes them as remaining accounts.
- A ninth open long fails with **`TooManyOpenLongs`**.
- Shorts, deposits, locks, and burns behave exactly as before.

## Dependencies

- [Collateral Manager](03-collateral-manager.md) — `UserCollateral` balances; `risk::check_withdraw_allowed` is its withdraw seam.
- [Premium Engine](07-premium-engine.md) — `update_index`, `accrue_long`, `payable_from`; the projection helper mirrors them.
- [Long Mint](06-long-mint-inventory.md) — the inventory gate runs first; this gate runs second.
- [Burn & Settle](08-burn-settle.md) — settling is how a long reduces its liability.

## State & PDAs

No new PDA. Two fields appended to `Market` (after `premium_multiplier`, offset-stable) and one to `UserCollateral`:

| Account | Field | Type | Default | Meaning |
|---|---|---|---|---|
| `Market` | `long_margin_horizon_slots` | `u64` | `1_000` | slots of future premium a long must hold |
| `Market` | `long_margin_buffer_usdc` | `u64` | `1_000_000` | flat µUSDC floor per long |
| `UserCollateral` | `open_longs` | `u16` | `0` | open LONG positions for this user on this market |

Defaults live in `state::risk_defaults` and are written by `create_market`. **Demo values, not fair value.** There is no setter in Fair MVP (component 10). `open_longs` mirrors `open_positions`, which counts shorts only.

Both accounts change size → **every existing account stops deserializing; `--reset` the ledger.**

## Public Interface (`risk.rs`, `premium.rs`)

```rust
pub const MAX_OPEN_LONGS: u16 = 8;

/// ceil(horizon × rate × L × mult / PREMIUM_SCALE) + buffer. Rounds UP; checked; MathOverflow on wrap.
pub(crate) fn required_margin(market: &Market, liquidity: u128) -> Result<u64>;

/// current_index + (now − last_update_slot) × rate. Pure; the index is never written.
pub(crate) fn projected_index(index: &GlobalPremiumIndex, rate: u64, now: u64) -> Result<u128>;

/// What `settle_premium` would charge this long right now, rounded UP. Never mutates.
pub(crate) fn payable_if_settled_now(pos: &PermaPosition, projected: u128, market: &Market) -> Result<u64>;

/// premium_owed_usdc + Σ (payable_if_settled_now_i + required_margin(L_i)). Pure over owned copies.
pub(crate) fn required_free_usdc(user: &UserCollateral, longs: &[PermaPosition], projected: u128, market: &Market) -> Result<u64>;

/// Validate remaining accounts as THE full set of this user's open longs. Returns owned copies.
pub(crate) fn collect_open_longs(remaining: &[AccountInfo], program_id: &Pubkey, market: &Pubkey, owner: &Pubkey, expected: u16) -> Result<Vec<PermaPosition>>;

/// Withdraw gate. Replaces the 03 stub body; the call site is unchanged.
pub(crate) fn check_withdraw_allowed(user, longs, projected, market, amount_a, amount_b) -> Result<()>;

/// Long-mint gate.
pub(crate) fn check_long_mint_allowed(user, longs, projected, market, new_liquidity) -> Result<()>;
```

## Algorithms

### Margin

```
required_margin(L) = ceil( horizon × premium_rate × L × premium_multiplier / PREMIUM_SCALE ) + buffer
```

At the shipped defaults `horizon × rate × mult / SCALE = 1_000 × 1_000_000 × 1_000 / 10^12 = 1`, so

```
required_margin(L) = L µUSDC + 1 USDC          (demo coincidence — not a law)
```

| L | margin |
|---|---|
| 1 | 1.000001 USDC |
| 50_000_000 | 51 USDC |
| 100_000_000 | 101 USDC |

Rounding: `q + (r != 0)`, never the `+ SCALE − 1` idiom (overflow). All products `checked_mul`; the result `u64::try_from`; sums accumulated in `u128`.

### Liability of an open long (read-only)

`accrue_long` reads only the global index; no `poke_range` is needed for a long. `withdraw_collateral` does not run the poke prefix, so the stored index may be stale — the projection closes that:

```
projected = index.current_index + (now − index.last_update_slot) × premium_rate
d_index   = projected − pos.entry_index
scaled    = pos.accrued_scaled + d_index × pos.liquidity × premium_multiplier
payable   = ceil(scaled / PREMIUM_SCALE)
```

Nothing is written: not the position, not its checkpoint, not the index. In `mint_position(LONG)` the shared prefix has already run `update_index`, so the projection is a no-op there and both callers share the function.

### The gate

```
required = premium_owed_usdc + Σ_i ( payable_if_settled_now(long_i) + required_margin(L_i) )

withdraw : free_b − amount_b  ≥ required                          else InsolventWithdrawal
long mint: free_b             ≥ required + required_margin(L_new)  else InsolventMint
```

`premium_owed_usdc` is the component-06 legacy liability, paid down by settle/burn and never increased since 08; it is included so pre-08 debts still count.

### Long mint order

```
inventory gate (NoShortInventory)            existing, unchanged
open_longs < MAX_OPEN_LONGS                  else TooManyOpenLongs
solvency (count == open_longs, + margin(L))  else InsolventMint
position::open_long(...)                     increments open_longs
```

The `balance_b > 0` stub is deleted.

### Remaining accounts

Both gates take `remaining_accounts` = every open long for `(market, owner)`. For each account: `Account::<PermaPosition>::try_from` (program owner + discriminator — **never** `try_deserialize_unchecked`), PDA re-derived from `["perma_position", market, owner, nonce_le, bump]`, `market` / `owner` / `leg_type == LONG` / `status == OPEN`, key-deduplicated. Then **`count == open_longs` in both directions** → `MissingOpenLong`. With N distinct valid open longs out of exactly N existing, the set is complete. A closed long's account no longer exists; `PendingPremium` is SHORT-only; the new long's own PDA cannot be smuggled in (Anchor writes the discriminator at `exit()`, so it fails `try_from` mid-handler).

Short users pass nothing: `open_longs == 0`, `0 == 0`, the index is not read, the sum is empty, and the check reduces to the component-03 `free_b_after ≥ premium_owed_usdc`.

**Why a long mint is small enough to carry them.** `MintPosition` is shared between legs. With every Orca account required, a long mint measured **1188 B** — room for one remaining account, and a mint whose fee payer was not the owner (three signatures) was already 1252 B. So the Orca-side accounts (`whirlpool`, `orca_position`, `position_mint`, `position_token_account`, mints, vaults, tick arrays, ATA/memo/whirlpool programs) are **`Option`**, passed as `null` by a long, and resolved by `MintShortAccounts::resolve` on the short path — the same pattern `BurnPosition` already used. Measured after: long mint **612 B** with no longs, **843 B** with seven; withdraw **755 B** with eight. Short mint is byte-identical at 1156 B.

## Invariants

1. **No withdraw below liability.** After any `withdraw_collateral`, `free_b ≥ premium_owed_usdc + Σ payable_if_settled_now + Σ required_margin` over the user's open longs.
2. **No insolvent mint.** A long cannot be opened unless invariant 1 holds with it included.
3. **`open_longs == |{ p : p.owner == user, p.market == market, p.leg == LONG, p.status == OPEN }|`** at all times (reconciled by `scripts/reconcile.mjs`).
4. **Solvency never writes.** `projected_index` / `payable_if_settled_now` are pure; the only writers of accrual remain `settle_premium` and `burn_position`.
5. **Short mint is byte-identical** in size to component 08 (1156 B). Nothing rides on it.
6. **Conservation unchanged.** `vault + Σ in_orca == Σ(free + locked)` and `range_vault.amount == premium_pool + dust` are untouched by this component — it only *refuses* transactions.

## Failure Modes & Errors

| Error | Raised by | Meaning |
|---|---|---|
| `InsolventWithdrawal` | withdraw | free USDC after the withdraw would be below the user's long liability + margin |
| `InsolventMint` | long mint | free USDC cannot cover existing liability + margin for the new long |
| `MissingOpenLong` | both | remaining accounts are not exactly the user's open longs |
| `TooManyOpenLongs` | long mint | `open_longs == MAX_OPEN_LONGS` |
| `MathOverflow` | both | margin product wrapped (huge L) |
| `OracleDeviationTooHigh` | — | **deferred (Protocol V1). Not defined, not raised.** |

New variants are appended to `PermaError`; on-chain codes are `6000 + index`.

## Security Notes

- **No price, no manipulation surface.** There is nothing for a flash-tick to move.
- **Stale-index attack closed by projection.** Without it, "open long → wait → withdraw before anyone cranks" under-counts by `(now − last_update) × rate × L × mult / SCALE`.
- **Set-completeness by counting.** The counter is maintained in the same functions that change a long's status, with `checked_sub`, so drift fails loudly instead of silently under-counting.
- **Rounding.** Margin and liability round *up*; nothing here changes `payable_from`'s floor-with-carry, which protects the permissionless crank.
- **Known, accepted (ADR-0003):** short mint and `lock_collateral` move free USDC → locked without consulting this gate. Not an extraction path — tokens exit only via the gated withdraw — but IL on a short can shrink the pot below a long's margin.

## Test Cases

| ID | Setup | Expect |
|---|---|---|
| **R1** | fresh user, exactly 1 µUSDC free, inventoried range, mint long L=1 | `InsolventMint` (passed under the stub) |
| **R2** | free_b ≥ margin(L), mint long | ok; `open_longs == 1` |
| **R3** | open long, wait N slots, withdraw leaving `free_b < accrued + margin` | `InsolventWithdrawal`; position untouched |
| **R4** | `settle_premium(long)`, then withdraw the remainder | ok |
| **R5** | omit an open long from remaining accounts | `MissingOpenLong` |
| **R6** | short burn: `free_after == free_before + returned − locked`; vault delta identical | conservation green; no second PnL |
| **R7** | open long, wait, **no crank**, withdraw exactly the stored-index liability | `InsolventWithdrawal` — proves projection |
| **R8** | ninth long | `TooManyOpenLongs`; `open_longs == 8` |
| **R9** | closed long's key / another user's long / duplicate | `MissingOpenLong` |
| unit | margin rounds up; `MathOverflow` at huge L; `projected_index == update_index` result; `payable_if_settled_now` never mutates; `required_free_usdc` sums; counter `++`/`−−` with `checked_sub` | — |

## Observability & Events

No new event. `InsolventMint` / `InsolventWithdrawal` are error returns, not events — a failed transaction has no log to index. `LongMinted` / `LongBurned` gain no fields.

## MVP Done Definition

- [x] `Market.long_margin_horizon_slots` / `long_margin_buffer_usdc` set from `risk_defaults` at `create_market`; `tests/factory.ts` asserts them.
- [x] `UserCollateral.open_longs` maintained by `position::open_long` / `close_long`; reconciled by `scripts/reconcile.mjs`.
- [x] `required_margin`, `projected_index`, `payable_if_settled_now`, `required_free_usdc` pure and unit-tested (10 tests in `risk.rs`).
- [x] `withdraw_collateral` carries `premium_index` and open longs as remaining accounts; `InsolventWithdrawal` on a real long liability (R3, R7).
- [x] `mint_position(LONG)`: `balance_b > 0` stub deleted; `InsolventMint` on real margin (R1); `TooManyOpenLongs` at 8 (R8).
- [x] No second PnL on short burn (R6 is a regression test); long burn P&L = 0.
- [x] Short mint still 1156 B; long mint 612 / 843 B (0 / 7 existing); withdraw 524 / 755 B (1 / 8 longs).
- [x] All prior suites green on one ledger, forward twice and reverse — 76 / 76 × 3.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
