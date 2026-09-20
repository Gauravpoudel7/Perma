# Component: Premium Engine

> **Scope:** Fair MVP (Part A of [`PRD.md`](../../PRD.md)). Flat, admin-set rate. Utilization- and demand-based pricing is **Part B and explicitly out of scope**.
> **Accounting model:** range-scoped premium bucket with pro-rata distribution. See [ADR-0002](../adr/ADR-0002-premium-accounting.md) and [`08-burn-settle.md`](08-burn-settle.md) for the settlement side.

## Purpose

The Premium Engine calculates and tracks the "cost of carry" for perpetual options. Since there is no expiry, the long party pays a streaming premium to the short parties who backed that range. The engine uses accumulator (index) accounting so that no position account has to be written every slot.

## User-Facing Behavior

In the UI, the user sees "Premium Owed" (Longs) or "Premium Earned" (Shorts) rising continuously. The amount is settled into collateral when the position is closed, or earlier via `settle_premium`.

## Dependencies

- **Position Engine** — supplies `entry_index` and `entry_acc_q64` checkpoints on each position
- **Market** — holds `premium_rate` and `premium_multiplier`
- **Collateral Manager** — performs the actual USDC debit/credit and holds the range escrow
- **Burn & Settle** — consumes this engine's outputs at close

---

## A. Units, Constants, and Parameters

**Premium is denominated and paid in USDC only**, in base units (µUSDC, 6 decimals). Shorts earn USDC even when their collateral is partly SOL. A two-asset premium split was rejected — see ADR-0002.

### Constants

| Name | Type | Value | Where | Set by |
|---|---|---|---|---|
| `PREMIUM_SCALE` | `u128` | `1_000_000_000_000` (1e12) | program constant | compile-time; not configurable |

### Market parameters

Both live on the **`Market` PDA**, written from `premium_defaults` at `create_market`. **There is no update instruction** — they are immutable in Fair MVP (a `set_market_*` admin path belongs to component 10). Users cannot influence either.

| Name | Type | Fair MVP default | Units |
|---|---|---|---|
| `premium_rate` | `u64` | `1_000_000` | index units per slot |
| `premium_multiplier` | `u64` | `1_000` | µUSDC · `PREMIUM_SCALE` per (liquidity unit × index unit) |

> **Naming:** `premium_multiplier` is the **only** name for this value. Earlier drafts wrote `MARKET_MULTIPLIER` or just "multiplier"; those names are retired.

**On the defaults.** These are tuned for **demo visibility**, not derived from an options-pricing model: they make premium move visibly within ~100 slots (~40 seconds) at demo position sizes. They are not a claim about fair value. Before any market with real size, recalibrate `premium_multiplier` against the notional value of one liquidity unit in the allowlisted pool, and record the calibration in an ADR.

### Why two parameters rather than one

They have different jobs and different reasons to change:

- `premium_rate` controls **how fast time accrues** — it is the clock speed of the index, independent of any position.
- `premium_multiplier` converts **index × liquidity into money** — it is the price conversion and depends on what a liquidity unit is worth in this pool.

Changing pools changes the multiplier; changing the desired carry cost changes the rate. Folding them into one number would conflate the two.

---

## B. The Canonical Formula

Units are given on every term. `L` is liquidity in Orca liquidity units (`u128`, matching `PermaPosition.liquidity`).

```
# 1. Global index advance (pure function of elapsed slots)
index [idx]            += elapsed_slots [slots] × premium_rate [idx/slot]

# 2. A position's accrual (no rounding — stays in scaled units)
accrued_scaled [µUSDC·SCALE]
                       += d_index [idx] × liquidity [L] × premium_multiplier [µUSDC·SCALE/(L·idx)]

# 3. Conversion to a real token amount, at transfer time only
payable [µUSDC]         = floor(accrued_scaled / PREMIUM_SCALE)
accrued_scaled          -= payable × PREMIUM_SCALE        # remainder carried forward
```

`d_index` is `index_now − position.entry_index`, and `entry_index` is rolled forward to `index_now` on every settle.

### Rounding policy

| Leg | Rule | Rationale |
|---|---|---|
| Long pays | **floor, with the sub-unit remainder carried on the position** | Exact over time; immune to settle-frequency manipulation (§C) |
| Short claims | **floor** | Pool can never be over-drawn by rounding |
| Residue | stays in `premium_pool`, unclaimable (the `dust` field is declared but **never written**) | Never silently credited to anyone |

**Ties do not exist.** Both legs floor; nothing rounds to nearest, so there is no tie to break. The residue between what a long paid and what shorts could claim remains in `premium_pool`, indistinguishable from unclaimed entitlement; separating it would need the O(n) recompute the accumulator exists to avoid (08 report residual #2). `dust` is reserved, always 0.

---

## C. Why floor-with-carry, and not round-up

This is the non-obvious part, and getting it wrong creates a griefing vector.

`settle_premium` is **permissionless** — anyone may crank it against any long position (§E). Combine that with rounding **up** per settle and an attacker can inflate a long's cost simply by settling often.

Worked demonstration, `L = 1500`, `premium_rate = 1e6`, `premium_multiplier = 1000`, over 100 slots. True cost per slot is `1e6 × 1500 × 1000 / 1e12` = **1.5 µUSDC**, so the honest total is **150 µUSDC**.

| Policy | 100 single-slot settles | Error |
|---|---|---|
| **floor + carry** (adopted) | pays `1, 2, 1, 2, …` → **150** | **exact** |
| ceil each settle | `2 × 100` → **200** | +33% — attacker-controlled overcharge |
| floor each, no carry | `1 × 100` → **100** | −33% — shorts silently underpaid |

Carrying the remainder makes settle frequency irrelevant: **100 single-slot settles and one 100-slot settle produce identical totals.** That property is what makes a permissionless crank safe, and it is covered by a dedicated test vector (`V6` in [`FIXTURES-AND-VECTORS.md`](../06-testing/FIXTURES-AND-VECTORS.md)).

---

## D. State & PDAs

### `GlobalPremiumIndex` PDA — `["premium_index", market]`

| Field | Type | Meaning |
|---|---|---|
| `current_index` | `u128` | Monotonically increasing; `Σ (elapsed_slots × premium_rate)` |
| `last_update_slot` | `u64` | Slot of the last advance |

`premium_rate` and `premium_multiplier` are read from the `Market` PDA, not stored here, so there is one authoritative copy.

### `RangePremiumState` PDA — `["range", market, tick_lower_le, tick_upper_le]`

One per distinct tick range. This is the premium bucket; full field semantics and the settlement flows live in [`08-burn-settle.md`](08-burn-settle.md) §A.

| Field | Type | Meaning |
|---|---|---|
| `total_short_liquidity` | `u128` | **Pro-rata denominator** — all short liquidity provided to this range |
| `total_long_liquidity` | `u128` | Drives entitlement accrual |
| `acc_premium_per_short_q64` | `u128` | Cumulative µUSDC per unit of short liquidity, Q64.64 |
| `last_index` | `u128` | `current_index` at the last range poke |
| `premium_pool` | `u64` | µUSDC actually escrowed |
| `receivable` | `u64` | Earned by shorts but not yet funded |
| `dust` | `u64` | Floor residue |

> `total_short_liquidity` is **not** `available_short_liquidity`. The latter (`total_short − total_long`) is the long-mint gate in [`06-long-mint-inventory.md`](06-long-mint-inventory.md). Using the available remainder as the pro-rata denominator would over-pay shorts as longs open. Two distinct fields.

### Position checkpoints

Carried on the `Position` PDA ([`04-position-engine-1leg.md`](04-position-engine-1leg.md)):

| Field | Applies to | Meaning |
|---|---|---|
| `entry_index` | Long | `current_index` at open or last settle |
| `accrued_scaled` | Long | Unpaid sub-unit remainder, in `µUSDC × PREMIUM_SCALE` |
| `entry_acc_q64` | Short | `acc_premium_per_short_q64` at open or last claim |

---

## E. Public Interface

### `update_index()`

Advances `current_index` by `(current_slot − last_update_slot) × premium_rate` and sets `last_update_slot = current_slot`.

**Poke reward: `0`.** There is no bounty, no funding source, and no payee. This is a deliberate Fair MVP decision, not an omission.

Staleness is harmless because **the index is a pure function of elapsed slots**. A late poke catches up exactly — `elapsed_slots` is measured from `last_update_slot`, so no accrual is lost or double-counted no matter how long the gap. The index cannot drift, only lag.

The index is refreshed automatically at the start of `mint_position`, `burn_position`, and `settle_premium`, so it is always current at the only moments a number is actually used. **There is no standalone poke instruction** — none is required for correctness, and a UI can compute the projected value off-chain from `last_update_slot` and `premium_rate`.

> A paid poke bounty was considered and rejected: the only available funding source is `premium_pool`, which is money that already belongs to shorts. See ADR-0002.

### `poke_range(range)`

Advances one range bucket's entitlement accumulator to the current index. Called internally by every mint, burn, and settle touching that range. Detailed in [`08-burn-settle.md`](08-burn-settle.md) §B.

### `accrue_long(position)`

```rust
fn accrue_long(index: &GlobalPremiumIndex, market: &Market, pos: &mut Position) {
    let d_index = index.current_index - pos.entry_index;
    pos.accrued_scaled += d_index
        * pos.liquidity
        * market.premium_multiplier as u128;
    pos.entry_index = index.current_index;          // roll forward
}
```

### `payable_from(position) -> u64`

```rust
fn payable_from(pos: &mut Position) -> u64 {
    let payable = (pos.accrued_scaled / PREMIUM_SCALE) as u64;
    pos.accrued_scaled -= payable as u128 * PREMIUM_SCALE;   // carry the remainder
    payable
}
```

### `claimable_for(short, range) -> u64`

```rust
fn claimable_for(pos: &Position, range: &RangePremiumState) -> u64 {
    (((range.acc_premium_per_short_q64 - pos.entry_acc_q64)
        * pos.liquidity) >> 64) as u64
}
```

---

## F. Worked Example (Gap A reference)

One long, no other activity. Matches vector **V1** in `FIXTURES-AND-VECTORS.md`.

**Setup:** `liquidity = 1_000_000` L · open at slot `S0` · close at slot `S1 = S0 + 100` · `premium_rate = 1_000_000` · `premium_multiplier = 1_000` · `PREMIUM_SCALE = 1e12`.

| Step | Computation | Result |
|---|---|---|
| 1. Index advance | `100 slots × 1_000_000` | `d_index = 100_000_000` |
| 2. Accrue | `100_000_000 × 1_000_000 × 1_000` | `accrued_scaled = 100_000_000_000_000_000` |
| 3. Convert | `floor(1e17 / 1e12)` | **`payable = 100_000` µUSDC** |
| 4. Carry | `1e17 − 100_000 × 1e12` | `accrued_scaled = 0` |

**The long pays 100 000 µUSDC = 0.10 USDC** for 100 slots (~40 s) at that size. The division is exact here, so the carry is zero; vectors V2–V4 exercise the non-exact cases.

---

## Invariants

1. **Monotonicity** — `current_index` never decreases.
2. **Linearity** — for a fixed size, premium accrues linearly in slots.
3. **Settle-frequency neutrality** — for any split of a slot range into sub-periods, the sum of the payments equals the single-shot payment. (§C)
4. **No unrounded loss** — every µUSDC either transfers, remains in `accrued_scaled`, or remains in `premium_pool` as unclaimable residue. Nothing is silently dropped.
5. **Zero protocol skim** — the engine takes no cut; every µUSDC a long pays is owed to shorts or sits as residue in the range pool.

## Failure Modes & Errors

| Error | Trigger |
|---|---|
| `NothingToSettle` | `settle_premium` called when `payable == 0` and no claim is outstanding |
| `PremiumPoolUnderfunded` | Defensive — a short claim exceeds `premium_pool + receivable` capacity; indicates an accounting bug |
| `RangeStateMismatch` | The passed `RangePremiumState` does not match the position's tick range |
| `MathOverflow` | `current_index` or `accrued_scaled` would exceed `u128` (checked arithmetic) |

`MathOverflow` on the index is not reachable at realistic parameters: at `premium_rate = 1e6` the index grows `~7.9e13` per year, so `u128` headroom is effectively unbounded. All arithmetic still uses checked operations.

## Security Notes

- **Rate manipulation** — `premium_rate` and `premium_multiplier` are admin-only fields on `Market`. No user-reachable path writes them.
- **Settle-frequency griefing** — neutralized by floor-with-carry (§C). This is the reason the permissionless crank is safe.
- **Stale-index gaming** — impossible; the index depends only on slot count, so delaying a poke changes nothing about the amount owed.
- **Precision** — all intermediate accrual is `u128` in scaled units. Never convert to a token amount except at transfer.

## Test Cases

- [x] **V1** — advance 100 slots, `L = 1e6` → `payable == 100_000`. *(`premium.rs::v1_single_long_accrual`)*
- [x] **V6 (anti-grief)** — 100 single-slot settles on `L = 1500` total exactly `150`, equal to one 100-slot settle. *(`premium.rs::v6_settle_frequency_neutrality`; the on-chain twin is `tests/settle-premium.ts` "settling twice costs the long exactly what settling once would")*
- [x] Carry correctness — after a settle, `accrued_scaled < PREMIUM_SCALE`.
- [x] `update_index` after a long idle gap credits exactly `elapsed_slots × premium_rate`.
- [x] `burn_position` refreshes the index before computing any amount (shared prefix).
- [ ] ~~Non-admin write to `premium_rate` or `premium_multiplier` → `Unauthorized`.~~ N/A — no write path exists for anyone (component 10).
- [x] Monotonicity — `current_index` never decreases (a stale `now_slot` is a no-op, not a rewind).

## Observability & Events

```rust
// Live event (component 08). Emitted by every settle path; `amount` is USDC that actually moved.
PremiumSettled { market, owner, perma_position, leg_type, amount, still_owed, premium_pool, premium_owed_usdc }
// Index updates and per-position accrual are NOT emitted - both are pure functions of slots and can be
// recomputed off-chain from `last_update_slot` / `entry_index`. Burns emit LongBurned / ShortBurned.
```

## MVP Done Definition

- [x] `GlobalPremiumIndex` PDA implemented; `update_index` advances by elapsed slots. *(component 06 scaffold)*
- [x] `premium_rate` and `premium_multiplier` live on `Market`, set from defaults at `create_market`, no update path. *(component 02)*
- [x] Accrual is scaled `u128`; conversion floors and carries the remainder. *(component 06 scaffold)*
- [x] Settle-frequency neutrality proven by the V6 vector (Rust unit test). *(component 06 scaffold)*
- [x] Poke reward is zero; `mint_position` / `burn_position` / `settle_premium` refresh the index first. *(06 scaffold; 08)*
- [x] Premium calculation integrated into `settle_premium` with **cash movement** — `vault_b ↔ range_vault`, never a clear without a transfer. *(component 08)*

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
