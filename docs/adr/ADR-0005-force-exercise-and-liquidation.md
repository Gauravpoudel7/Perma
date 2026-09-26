# ADR 0005: Force exercise + liquidation (Protocol V1 P4)

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

**Date**: 2026-09-25 (Proposed), 2026-09-26 (Accepted)
**Status**: **Accepted.** The product owner asked for the engineering recommendations on Q1–Q6 after a Panoptic review (2026-09-26); they are recorded under §Decisions.
**Decider(s)**: product owner (the choice to take the recommendations), PERMA engineering (structure and numbers)
**Builds on**: [ADR-0003](ADR-0003-fair-mvp-risk-model.md) (premium-horizon solvency), [ADR-0004](ADR-0004-oracle-and-price-aware-risk.md) (reference price, §Forward)
**Problem statement**: [`LIQUIDATION-AND-FORCE-EXERCISE.md`](../09-post-mvp/LIQUIDATION-AND-FORCE-EXERCISE.md), `PRD.md` B20/B21/B30. Feasibility: [`IMPL-P4-FEASIBILITY.md`](../audits/IMPL-P4-FEASIBILITY.md).

### Context

Only a long can owe anything today. It owes premium, which accrues with time, and solvency is checked only when free USDC leaves: at withdraw and at mint-long (`risk.rs:165`, `:195`).

- A long whose owner stops paying stays `Open`, because its burn fails rather than closing into a debt (`lib.rs:1916`).
- It also pins the shorts under it: a short may not burn below `total_long_liquidity` (`lib.rs:990-993`).
- Nobody but the owner can close it (`lib.rs:2464-2480`).

P4 adds two third-party closes for a **long**:

- **Liquidation** is about account solvency.
- **Force exercise** is about seller liveness.

Shorts are never liquidated: a short owes nothing, and its collateral is its own locked tokens.

### Panoptic reference (behaviour only — BUSL code, nothing copied)

Sources are Panoptic's public docs and the Code4rena audit repos (2024-09 and 2025-12). Only the *mechanism* is borrowed.

| Topic | Panoptic v1.x | PERMA P4 |
|---|---|---|
| Insolvent when | Collateral value < requirement at `NO_BUFFER` (100%). Mints and withdraws need `BP_DECREASE_BUFFER` (133.33%), so initial = 4/3 × maintenance. | Same shape: maintenance = **75 %** of the initial margin (§1). |
| Price for liquidation | Must be insolvent at *all* of fast oracle, 10-min TWAP, last observed and current tick. Reverts `StaleTWAP` if \|current − TWAP\| > 513 ticks (~5 %). | **No price at all.** PERMA solvency is premium over time (ADR-0003), so spot manipulation cannot make an account liquidatable. |
| Scope per call | Burns *every* position of the account (≤ 32) in one call. | **One long per call** (1232-byte tx; longs span ranges). Re-checked every call, so it is a partial liquidation that stops once the account is healthy. |
| Bonus | `min(balance / 2, requirement − balance)` at TWAP. | `min(free_after_premium / 2, shortfall, m × margin of the closed long)` (§1). The last term is new: it stops a split liquidation from out-earning a single one. |
| Bad debt | Premium the liquidatee paid is haircut; the remaining loss is absorbed by the pool's LPs (socialized). | **Never socialized** (PRD B30). A shortfall closes the long, auto-pauses the market, and the shorts keep the unpaid part as their existing `premium_receivable` carry (§4). |
| Force exercise eligible | At least one long leg with the TWAP outside its range. | The long's range is out of range by a margin that guarantees the *Pyth* price is outside it too (§2). |
| Force fee | `FORCE_EXERCISE_COST >> (n − 1)`, where `n` = half-widths between price and strike (max over legs, floor 1). Docs: ~1.024 % near, 0.01 % far. Paid by the exercisor to the exercisee. | Same payer and payee. **Amended by [ADR-0006](ADR-0006-value-based-premium.md):** a flat 0.1 % of the long's notional `L·v`, with no halving (§2). |
| Exercisor | Anyone. Must be solvent afterwards (133 % buffer). | Anyone with a PERMA account in the market. Must pass the existing withdraw solvency gate for the fee (§2). |
| Who liquidates | Anyone; bots are encouraged. | Anyone (Q5). |

### Decision

#### 1. Liquidation — `liquidate_long`

- **Accounts.**
  - The signer is the liquidator, with their own `UserCollateral` in this market.
  - The target is a long plus its owner's `UserCollateral`, `RangePremiumState`, range vault, and premium index.
  - Remaining accounts: the owner's **full** open-long list, validated by the existing `risk::collect_open_longs` (`risk.rs:230`). The target must be in that list.
- **Premium and margin are priced on notional since [ADR-0006](ADR-0006-value-based-premium.md).** `required_margin` below is `⌈horizon × rate × mult × L·v / (2^64·1e12)⌉ + buffer`. The maintenance and bonus formulas are unchanged; they read that margin.
- **Maintenance requirement.** `maint = premium_owed_usdc + Σ payable_if_settled_now + ⌈Σ required_margin × MAINT_MARGIN_BPS / 10_000⌉`, with **`MAINT_MARGIN_BPS = 7_500`**. Owed premium always counts in full; only the forward margin is discounted. The initial requirement at mint and withdraw is unchanged (100 % of margin), so the ratio of initial to maintenance margin is Panoptic's 4/3.
- **Eligible** when `free_usdc < maint`. Otherwise it fails with `AccountSolvent` and nothing moves.
- **Effect, in order:**
  1. Poke the index and the range, as the burn prefix does.
  2. Accrue the target long.
  3. Pay its premium: `paid = min(payable, free_usdc)`, a real transfer from `vault_b` to the range vault via `apply_long_payment`.
  4. If `paid == payable`, the bonus is `min(R / 2, D, ⌈m × required_margin(target)⌉)`:
     - `R` is the free USDC left after step 3.
     - `D = maint − free_usdc`, measured before step 3.
     - `m` is `MAINT_MARGIN_BPS / 10_000`, so the third term is the maintenance margin the close releases.

     The bonus is credited from the owner's free USDC to the liquidator's free USDC. It is an internal ledger move; no token moves.
  5. If `paid < payable`, there is a **shortfall**: no bonus, and §4 applies.
  6. `position::close_long`, decrement `total_long_liquidity`, and close the account with rent to the owner.
- **Why the three-way bonus cap.** Each call can release at most `m × margin` of maintenance, so the bonus never exceeds what the close frees. The shortfall therefore never grows between calls, and the total bonus over any split is at most the sum of the released maintenance margins.

#### 2. Force exercise — `force_exercise`

- **Accounts.**
  - The signer is the exercisor, with their own `UserCollateral` in this market.
  - The target is a long plus its owner's `UserCollateral`, range state, range vault, and premium index.
  - Also the `whirlpool` and a Pyth `price_update`.
  - Remaining accounts: the **exercisor's** full open-long list, for the fee gate.
- **Eligible** when both of these hold:
  - The pool tick is at least **`FX_BAND_TICKS = 310`** ticks outside the long's range: `tick ≥ tick_upper + 310` or `tick + 310 < tick_lower`.
  - `oracle::check_price` passes with **`FX_MAX_STALENESS_SECS = 30`**, plus the unchanged 100 bps confidence and 200 bps deviation limits.

  Together these put the reference price outside the range even at `price ± conf`. The worst case is below the range, where `price + conf ≤ (1.01 / 0.98) × spot ≈ 1.0306 × spot`, and 1.0001^310 ≈ 1.0315. Above the range, `price − conf ≥ (0.99 / 1.02) × spot` needs less. A unit test derives this from the oracle constants. Moving spot alone cannot trigger an exercise, and a single spot tick is never trusted. Otherwise it fails with `NotExercisable`.
- **The caller may not be the owner** (`SelfTarget`, for both instructions): the owner can simply burn, and one account on both sides would be written twice. In practice Anchor refuses first (`ConstraintDuplicateMutableAccount` on `user_collateral`); `SelfTarget` stays as the explicit guard should that check ever be relaxed.
- **Effect, in order:**
  1. Poke the index and the range.
  2. Accrue the target long and pay its premium **in full** (the `pay_long_premium_cash` path). An owner who cannot pay fails `InsufficientCollateralForLoss`, which routes the case to liquidation first (§5).
  3. The fee moves from the exercisor's free USDC to the owner's free USDC, as an internal ledger move. It is gated by `risk::check_withdraw_allowed(exercisor, longs, …, 0, fee)`, the same gate a withdraw of `fee` would face.
  4. `close_long`, decrement `total_long_liquidity`, and close the account with rent to the owner.
- **Fee (amended 2026-09-26 by [ADR-0006](ADR-0006-value-based-premium.md) Q3).**
  - **`fee = max(1, ⌈L·v × FX_FEE_BPS / 10_000⌉)`** µUSDC, with **`FX_FEE_BPS = 10`** (0.1 % of the long's notional; `v = √P_upper − √P_lower`).
  - It no longer depends on how far out of range the pool is.
  - *Superseded:* the original fee was 100 slots of premium on `L`, halved per half-width from the range midpoint (`FX_FEE_BASE_SLOTS`, `FX_FEE_MAX_HALVINGS`). Once premium became notional-based, that base shrank to almost nothing, so the ADR-0006 answer replaced it.
- **The long's P&L stays 0.** There is still no counterparty for intrinsic value (ADR-0004). "Exercise" is a close at no intrinsic payout, and the fee is the owner's compensation.

#### 3. Numbers (the only place they are set; fixtures in `FIXTURES-AND-VECTORS.md` §8)

| Constant | Value | Where |
|---|---|---|
| `MAINT_MARGIN_BPS` | 7_500 | `risk.rs` |
| `FX_BAND_TICKS` | 310 | `oracle.rs` |
| `FX_MAX_STALENESS_SECS` | 30 | `oracle.rs` |
| `FX_FEE_BPS` | 10 (0.1 % of notional; replaces `FX_FEE_BASE_SLOTS` / `FX_FEE_MAX_HALVINGS`, ADR-0006) | `risk.rs` |
| `PAUSE_SHORTFALL_MIN_USDC` | 1_000_000 (1 USDC) | `risk.rs` (amended 2026-09-26, §4) |

These are demo values. Change them only by amending this ADR. They are constants rather than `Market` fields: YAGNI until a second market needs different ones.

#### 4. Pause and bad debt

- Both instructions reduce risk, so they are **allowed while paused**, as withdraw, settle and burn are today (Q6). A pause therefore cannot trap an insolvent account in accrual.
- Any **shortfall** liquidation (`paid < payable`):
  - pays no bonus
  - emits `shortfall > 0`
  - leaves the range's shorts holding the unpaid part as `premium_receivable` carry
- **Dust floor (amended 2026-09-26).** Only a shortfall of **`PAUSE_SHORTFALL_MIN_USDC` = 1 USDC or more** sets `market.is_paused = true` in the same instruction. A smaller shortfall is **written off**: the long closes, the shorts keep the unpaid dust as carry, and the market stays open.
  - **Why:** without a floor, anyone could open a tiny long, let it run past its margin, and halt trading for everyone for a few µUSDC. 1 USDC is the default margin buffer every long posts.
  - **Accepted cost:** an owner with 8 longs could write off just under 8 USDC in total. Each write-off is visible as `shortfall` (with `paused = false`) in `LongLiquidated`, so ops can alert on the sum.
- **Who can unpause:** only the protocol admin, `GlobalConfig.admin`, through `unpause_market` (`factory::require_admin`, else `Unauthorized`). Today that is `7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY`; it changes only through `transfer_admin`. Liquidators, owners and the market's shorts cannot unpause. After an auto-pause, the admin follows PRD B30 (pause → assess → public note → remediation) before `unpause_market`. There is no haircut and no socialization.

#### 5. Ordering when both apply

**Liquidation first.** Force exercise pays the target's premium in full or fails, so an owner who cannot pay can only be liquidated. No extra check is needed.

#### 6. Oracle

- Liquidation reads **no price** (Q1 = A).
- Force exercise reads the reference through `oracle::load_price_update` and `check_price`, with the 30 s window.
- A `posted_slot` monotonicity check is **not** added. The 310-tick band makes cherry-picking a 30 s-old update immaterial; add it if the band is ever narrowed.
- Any oracle failure refuses the instruction. The owner's own exits read no oracle and are unaffected.

#### 7. Conservation and events

- **Moves:**
  - premium: `owner free_b → range_vault`, a real SPL transfer, as in settle
  - bonus: `owner free_b → liquidator free_b`, internal
  - fee: `exercisor free_b → owner free_b`, internal

  Both `scripts/reconcile.mjs` identities stay exact.
- **Events:**
  - `LongLiquidated { market, owner, liquidator, perma_position, size, premium_paid, bonus, shortfall, paused }`
  - `LongForceExercised { market, owner, exercisor, perma_position, size, premium_paid, fee, tick, reference_price, conf, publish_time }`
- **Errors** are appended after 6040: `AccountSolvent` 6041, `NotExercisable` 6042, `SelfTarget` 6043.
- The indexer's `/liquidations` and the client's refusal of a non-empty array change in a **later** web slice, not in the program slice.

### Decisions (Q1–Q6, 2026-09-26)

| # | Question | Decision |
|---|---|---|
| Q1 | Account-value model | **A: premium-only.** No price on the liquidation path. |
| Q2 | Maintenance and bonus | `MAINT_MARGIN_BPS = 7_500`. Bonus `min(R/2, D, m × margin)`. |
| Q3 | Force fee | 0.1 % of the long's notional (amended by ADR-0006; originally a 100-slot premium base with distance halving). |
| Q4 | P4 staleness | 30 s, force exercise only. |
| Q5 | Who may call | Anyone with a PERMA account in the market; caller ≠ owner. |
| Q6 | Pause | Both allowed while paused; a shortfall of 1 USDC or more auto-pauses, smaller ones are written off (amended 2026-09-26). Only `GlobalConfig.admin` unpauses. |

### Test vectors

| Vector | Where | Asserts |
|---|---|---|
| `LIQ_SOLVENT_REJECT` | `risk.rs` unit + `tests/liquidation.ts` | At or above maintenance → `AccountSolvent`, nothing moves |
| `LIQ_INSOLVENT_OK` | same | Below maintenance → closes; premium paid first; bonus = the three-way min |
| `LIQ_SPOT_SPIKE_FAIL` | `tests/force-exercise.ts` | Spot OOR but reference in range (deviation) → refused. Liquidation has no price to spike. |
| `LIQ_STALE_ORACLE_FAIL` | `tests/force-exercise.ts` | Update older than 30 s → `OracleStale` |
| `LIQ_PAUSE_INTERACTION` | `tests/liquidation.ts` | Allowed while paused; a shortfall ≥ 1 USDC sets `is_paused` and emits `shortfall` |
| `LIQ_DUST_NO_PAUSE` | `risk.rs` unit + `tests/liquidation.ts` | A tiny insolvent account (shortfall > 0, < 1 USDC) is closed with no bonus, and the market stays unpaused |
| `FX_IN_RANGE_REJECT` | `risk.rs` unit + `tests/force-exercise.ts` | Tick inside the range or within the 310-tick band → `NotExercisable` |
| `FX_OOR_OK` | `tests/force-exercise.ts` | Eligible → closes; fee to the owner; `available_short_liquidity` restored; the short can burn |
| `FX_NEAR_RANGE_FEE` / `FX_FAR_RANGE_FEE` | `risk.rs` unit, `FIXTURES-AND-VECTORS.md` §8 | Fee at the frozen points |
| `BOTH_CONSERVATION` | both suites + `reconcile.mjs` | Both identities exact after each |
| `SPOOF_POSITION_LIST` | both suites | Duplicate, foreign or missing long → `MissingOpenLong`; target not in the list → refused |

### Consequences

- **Positive**:
  - The Fair "stuck long" is gone, and sellers can always recover pinned inventory.
  - No new ledger: eligibility reuses `required_free_usdc` and `collect_open_longs`.
  - Liquidation cannot be price-manipulated, because it reads no price.
- **Negative, accepted**:
  - An 8-long account may need up to 8 liquidation calls.
  - There is no intrinsic payout: force exercise is a close plus a fee, not a Panoptic-style exercise.
  - A shortfall halts the market until an admin acts.
  - The force fee is premium-denominated, not a % of notional (PERMA has no notional without tick → price math).

### Not in P4

Multi-leg portfolio margin (P5), a non-Orca CLMM (P6), WSOL as margin, price-valued account value, a PERMA oracle ring, Switchboard, and any Panoptic code.

Sources:
- [Panoptic — Liquidations](https://panoptic.xyz/docs/panoptic-protocol/liquidations)
- [Panoptic — Force Exercise](https://panoptic.xyz/docs/product/force-exercise)
- [Code4rena 2024-09 Panoptic (PanopticPool / CollateralTracker)](https://github.com/code-423n4/2024-09-panoptic)
- [Code4rena 2025-12 Panoptic](https://github.com/code-423n4/2025-12-panoptic)
- [Panoptic whitepaper (arXiv 2204.14232)](https://arxiv.org/abs/2204.14232)
