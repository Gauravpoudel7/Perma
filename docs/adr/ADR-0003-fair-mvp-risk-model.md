# ADR 0003: Fair MVP Risk Model — solvency without a price

**Date**: 2026-09-20
**Status**: Accepted
**Decider(s)**: PERMA engineering
**Supersedes**: the price/TWAP language in `09-risk-solvency.md` (pre-rewrite), `08-burn-settle.md` §E steps 3–4, `THREAT-MODEL.md` "Observation Gates", and every doc claim that a solvency gate already exists (see [`DOCS-SYNC-AUDIT-09.md`](../audits/DOCS-SYNC-AUDIT-09.md) cluster A).

### Context

After component 08 the money is real: premium moves as USDC, and every liability decrement is paired with a transfer. What is still missing is the gate that stops a long from **running away from its debt**:

- `mint_position(LONG)` admits any user with `balance_b > 0` — one µUSDC is enough (a deliberate stub, `lib.rs`, marked "NOT `InsolventMint`").
- `withdraw_collateral` is gated by `risk::check_withdraw_allowed`, which reads free balance and the legacy `premium_owed_usdc`. **It cannot see accrued premium on open longs**: that accrual lives on `PermaPosition.accrued_scaled` / `entry_index`, and component 08 made `premium_owed_usdc` zero-or-decreasing forever. So a long can open, wait, withdraw every µUSDC, and leave the range's shorts holding a `receivable` nobody will fund. Fair MVP has no liquidation (`PRD.md` §A2), so nothing recovers it.

The existing spec, `09-risk-solvency.md`, could not close this as written. It named no margin number; it called `risk::calculate_pnl`, which does not exist; and it mandated `clmm_adapter.get_observations()` with a spot-vs-TWAP deviation check. **That API does not exist.** `orca_whirlpools_client` 8.0.0 contains no observation array and no TWAP — zero matches for either word in the crate. The `Oracle` PDA is adaptive-fee state (`volatility_accumulator`, `tick_group_index_reference`, timestamps), not a price ring. `Whirlpool` exposes spot `sqrt_price` / `tick_current_index` and nothing historical.

Two further traps sat in `08-burn-settle.md` §E: a long-burn pseudocode that `credit_usdc`'d intrinsic value with no counterparty (prints USDC from the shared vault), and a short-burn step that applied `calculate_pnl` on top of `close_short`, which already realizes `returned − locked` (double-counts, breaks conservation).

### Options Considered

**1. Where does the price come from?**

- **1a — Orca observations / TWAP.** *Rejected: does not exist.* Claiming it would be a fake oracle.
- **1b — PERMA-maintained tick ring**, written on every mint/burn/settle, crude TWAP over a window. *Rejected for Fair MVP*: adds a writable account to short mint (76 B of headroom left — measured), the window is only as dense as PERMA's own traffic (a demo pool sees a handful of transactions), and a thin ring is easier to manipulate than the spot it replaces.
- **1c — External oracle (Pyth).** *Rejected for this session*: a new dependency and account family, new failure modes (staleness, confidence), and it still leaves the short-mint size problem. Reasonable for Protocol V1.
- **1d — No price input at all.** Solvency is a function of token balances, premium liability, and an explicit USDC margin. Spot is used for range gating only. *Chosen.*

**2. What is "margin" for a long?**

- **2a — A percentage of notional.** *Rejected*: notional requires a price (option 1), and any percentage would be invented — nothing in the protocol derives it.
- **2b — Premium over a horizon.** The one thing PERMA already knows exactly about a long is what it will owe per slot: `premium_rate × L × premium_multiplier / PREMIUM_SCALE`. Require the user to hold that for a configurable horizon, plus a flat buffer. Every number except the horizon is already shipped. *Chosen.*

**3. How does solvency see a user's open longs?**

- **3a — Remaining accounts + a counter.** The caller passes every open long; the handler validates each and requires `count == UserCollateral.open_longs`. Liability is computed from the actual positions with the actual accrual math. *Chosen.*
- **3b — A running `UserCollateral.accrued_liability` aggregate.** O(1), no remaining accounts. *Rejected*: it is a second ledger of exactly the "number without a source" shape component 08 spent its whole scope removing. Accrual advances with time, so the stored figure is stale the moment a slot passes unless every touch mirrors it perfectly, and a missed mirror site is a silent under-count. The whole point of 09 is to not under-count.

**4. What about P&L on burn?**

- **4a — Implement `calculate_pnl` and apply it.** *Rejected*: there is no honest price to value against (option 1), the short side is already realized by `close_short`, and a long intrinsic credit has no funded counterparty.
- **4b — Expose `calculate_pnl` as a read-only view.** *Rejected*: a view against spot invites the next component to "just apply it". Nothing to view against honestly.
- **4c — No PnL instruction. Short burn realizes `returned − locked` via `close_short`, as today. Long burn P&L = 0.** *Chosen.* Long intrinsic value is Protocol V1, with force-exercise as the counterparty mechanism.

### Decision

**Solvency is a token-and-time computation with no price input.** Spot `tick_current_index` remains display / range-gating only. `OracleDeviationTooHigh` is **not added** to `errors.rs`; the catalog marks it deferred.

**Margin parameters** — two fields appended to `Market` after `premium_multiplier` (offset-stable), set from `risk_defaults` at `create_market`, admin-only by construction (no setter in 09; a `set_market_risk_params` belongs to component 10):

| Field | Default | Meaning |
|---|---|---|
| `long_margin_horizon_slots: u64` | **1_000** (~6.7 min at 400 ms) | slots of premium a long must be able to pay from free USDC |
| `long_margin_buffer_usdc: u64` | **1_000_000** (1 USDC) | flat floor so a dust-sized long still needs real money |

```
required_margin(L) = ceil( horizon × premium_rate × L × premium_multiplier / PREMIUM_SCALE ) + buffer
```

**Rounds up** (protocol-conservative), `checked_mul` throughout, fails `MathOverflow` rather than wrapping. At the shipped defaults `horizon × rate × mult / SCALE = 1`, so **`required_margin(L) = L µUSDC + 1 USDC` exactly** — a 1:1 coincidence of the demo numbers, called out so nobody mistakes it for a law. A 50e6 long needs 51 USDC; a 1-unit long needs 1.000001 USDC. **These are demo values, not fair value.** Short margin is unchanged: the locked spend *is* the collateral.

**Liability of an open long, read-only:** `premium::payable_if_settled_now(pos, projected_index, market)` mirrors `accrue_long + payable_from` on a copy and rounds **up**. It never writes the position, its checkpoint, or the index. The index it reads is **projected**: `projected_index = current_index + (now − last_update_slot) × premium_rate`, because `withdraw_collateral` does not run the poke prefix and a stale stored index would under-count everything since the last crank. Rounding up here does not conflict with `payable_from`'s floor-with-carry — nothing is written, crank frequency stays neutral, and `ceil ≥ floor` guarantees a withdraw that passes leaves enough for the next settle.

**The gate, one function, two callers:**

```
required_free_usdc(user, longs, projected_index, market)
    = premium_owed_usdc + Σ_i ( payable_if_settled_now_i + required_margin(L_i) )

withdraw_collateral : free_b_after ≥ required_free_usdc(existing)                      else InsolventWithdrawal
mint_position(LONG) : free_b       ≥ required_free_usdc(existing) + required_margin(L)  else InsolventMint
```

Long mint order: inventory gate (`NoShortInventory`) → `open_longs < MAX_OPEN_LONGS` (`TooManyOpenLongs`) → solvency (`InsolventMint`) → `position::open_long` (increments the counter). The `balance_b > 0` stub is deleted, not kept alongside.

**Open longs are passed as remaining accounts and counted.** `UserCollateral.open_longs: u16` is maintained inside `position::open_long` / `close_long` (`checked_sub`, so drift fails loudly). `withdraw_collateral` and `mint_position(LONG)` take `remaining_accounts` = every open long for `(market, owner)`; the handler deserializes each with `Account::<PermaPosition>::try_from` (program owner + discriminator — never unchecked), re-derives the PDA from `(market, owner, nonce, bump)`, checks `market`, `owner`, `leg_type == LONG`, `status == OPEN`, rejects duplicates, and requires **`count == open_longs` in both directions** (`MissingOpenLong`). N distinct valid open longs out of exactly N existing is the full set. `MAX_OPEN_LONGS = 8` bounds the remaining-account list to what one transaction carries with room to spare.

**Measured, and one consequence the plan did not predict.** `MintPosition` is shared between legs, and with every Orca account required a long mint was **1188 B** — room for one remaining account, and a mint paid for by a different fee payer was already **1252 B**, over the limit with zero longs. `MAX_OPEN_LONGS = 1` would have gutted the feature. The fix is the pattern `BurnPosition` already uses: the fifteen Orca-side accounts on `MintPosition` are **`Option`**, a long passes `null` for all of them and no position-mint signer, and `MintShortAccounts::resolve` re-asserts every constraint on the short path. Measured after: long mint **612 B** (no longs) / **843 B** (seven); withdraw **524 B** (one) / **755 B** (eight); short mint **byte-identical at 1156 B**.

**No P&L instruction.** `08-burn-settle.md` §E is corrected: short burn's realized LP result is `returned − locked`, applied once by `close_short`; long burn pays premium in cash and closes with P&L = 0.

**New errors** (`InsolventMint`, `MissingOpenLong`, `TooManyOpenLongs`) are **appended** to `PermaError` so no existing on-chain code (`6000 + index`) shifts.

### Consequences

- **Positive**: the one hole 08 left — a long withdrawing premium it will owe — is closed with arithmetic the protocol already ships, no oracle, no invented percentage, no second ledger. Short mint is untouched (76 B headroom preserved). Short users see no behaviour change: with `open_longs == 0` the gate reduces to today's check.
- **Negative, accepted**:
  - **An underwater long is still stuck.** Margin covers `horizon` slots; past that, if the owner neither settles nor deposits, the position cannot close (§G of 08) and there is no liquidation. That is the Fair MVP boundary, unchanged.
  - **Short mint and `lock_collateral` are not long-aware.** Both move free USDC → locked without consulting the long gate. Not an extraction vector — tokens leave only through the gated withdraw, and unlock / short burn return funds to free before any withdraw check — but a short's impermanent loss can shrink the pot below a long's margin. Same class as "no liquidation"; documented, not coded.
  - **Account layouts change** (`Market` +16 B, `UserCollateral` +2 B). Every existing account stops deserializing; a `--reset` ledger is mandatory.
  - **`MAX_OPEN_LONGS = 8`** per user per market. A ninth long is refused. Room remains (~390 B on the worst-case long mint) to raise it; nothing else has to change.
- **`MintPosition`'s Orca accounts are `Option`.** A client that passes them on a long mint wastes bytes but is not wrong; a client that omits one on a short mint fails `InvalidAsset` before any CPI.
  - **The margin is demo-tuned.** At 1,000 slots it equals `L µUSDC + 1 USDC`; a mainnet parameterisation would be a different ADR.
- **Forward requirement for component 10**: a `set_market_risk_params` instruction **must re-validate `horizon × premium_rate × premium_multiplier` against a maximum-L bound**, or a large parameter can make `required_margin` overflow for existing longs and brick their owners' withdraws. Overflow at mint is harmless (the mint fails); overflow at withdraw locks funds.
- **Forward note for Protocol V1**: long intrinsic value needs a funded counterparty — force-exercise against short collateral, or a settlement pool — before any credit is honest. Until then, "P&L = 0 on long burn" is the only conserving answer.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
