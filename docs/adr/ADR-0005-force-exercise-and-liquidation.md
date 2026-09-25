# ADR 0005: Force exercise + liquidation (Protocol V1 P4)

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

**Date**: 2026-09-25
**Status**: **Proposed.** No `liquidate_*` or `force_*` code, and no liquidation-distance UI, until this is Accepted with every row of §Open questions answered.
**Decider(s)**: product owner (open questions), PERMA engineering (structure)
**Builds on**: [ADR-0003](ADR-0003-fair-mvp-risk-model.md) (premium-horizon solvency), [ADR-0004](ADR-0004-oracle-and-price-aware-risk.md) (reference price, conservative selection, §Forward)
**Problem statement**: [`LIQUIDATION-AND-FORCE-EXERCISE.md`](../09-post-mvp/LIQUIDATION-AND-FORCE-EXERCISE.md), `PRD.md` B20/B21/B30. Feasibility: [`IMPL-P4-FEASIBILITY.md`](../audits/IMPL-P4-FEASIBILITY.md).

### Context

Today only a long can owe anything. It owes premium, which accrues with time, and solvency is checked only when free USDC leaves: at withdraw and at mint-long (`risk.rs:165`, `:195`). A long whose owner stops paying stays `Open`. Its burn fails rather than closing into a debt (`lib.rs:1916`). It also pins the shorts under it, because a short may not burn below `total_long_liquidity` (`lib.rs:990-993`). Nobody but the owner can close it (`lib.rs:2464-2480`).

P4 adds two third-party closes for a **long**:

- **Liquidation** handles *account solvency*. The owner's free USDC no longer covers what their longs owe.
- **Force exercise** handles *seller liveness*. The long's range is out of the money, so it pins inventory while paying premium on liquidity nobody uses.

Shorts are never liquidated. A short owes nothing, and its collateral is its own locked tokens (feasibility Q0 #1).

### Decision (proposed)

#### 1. Liquidation — `liquidate_long`

- **Unit.** One long per instruction. The caller passes the target long, the owner's `UserCollateral`, and the owner's **full** open-long list, validated by the existing `risk::collect_open_longs` (`risk.rs:230`). Eligibility is a whole-account fact and is re-checked on every call, so a partial run can never close a long of a solvent account.
- **Eligibility.** `free_usdc < premium_owed_usdc + Σ payable_if_settled_now + m × Σ required_margin`, where `m` is the maintenance factor (Q2). The initial requirement, enforced at mint, stays at `m = 1`. With `m = 0` an account becomes liquidatable only once it is already unpayable, and then there is nothing left to pay a bonus with, so `0 < m < 1` is expected.
- **Effect, in order:**
  1. Poke the index and range (same prefix as burn).
  2. Pay `min(payable, free_usdc)` to the range vault (the `settle_long_cash` path).
  3. Pay the bonus to the liquidator, capped per §3.
  4. `position::close_long`, then decrement `total_long_liquidity`.
  5. Close the position account, with rent to the owner.
- **Shortfall** (`payable > free_usdc`). The long still closes, which stops further accrual. The unpaid part is **bad debt**, handled per §4.

#### 2. Force exercise — `force_exercise`

- **Eligibility.** The long's whole range `[tick_lower, tick_upper)` is out of range by the **reference price**, not by spot:
  - above the range: `price − conf > price(tick_upper)`
  - below the range: `price + conf < price(tick_lower)`

  These are the ADR-0004 conservative rules, applied in the direction that makes eligibility harder. The pool spot must also pass `oracle::check_price` in the same instruction and sit on the same side. **Never a single spot tick.**
- **Precondition.** The target account is solvent under §1. If it is not, the call fails, and liquidation goes first (§5).
- **Effect.**
  1. Settle the long's premium in full.
  2. The exercisor pays the force fee (§3) to the exercisee as an internal free-USDC ledger move. No new tokens are minted.
  3. `close_long`, then decrement `total_long_liquidity`.

  The long's P&L stays 0: there is still no counterparty for intrinsic value (ADR-0004 migration map). "Exercise" here means the long is closed at no intrinsic payout, and the fee is its compensation.

#### 3. Bonus and fee structure (numbers in §Open questions)

- **Liquidation bonus.** A share of the target account's remaining free USDC *after* premium is paid, with a hard cap per account, not per call. Splitting a liquidation into more calls must not earn more. It is paid as an internal credit to the liquidator's `UserCollateral` in this market; the liquidator withdraws it normally. The bonus is never paid when there is a shortfall.
- **Force fee.** Paid by the exercisor to the exercisee. It decreases with distance from the range (larger near the boundary, smaller far out of the money), and it is a pure function of `(reference price, tick_lower, tick_upper)` so it can be frozen as fixtures.

#### 4. Pause and bad debt

- Both instructions are **risk-reducing exits**, so, like withdraw, settle, and burn today, they do not check `is_paused` (`lib.rs` checks only deposit, lock, mint, and the harness: `:407/:545/:615/:1047/:1189`). Proposed so that an admin pause cannot trap an insolvent account in accrual (Q6).
- **Bad debt is never socialized silently** (PRD B30). A shortfall liquidation:
  - sets `market.is_paused = true` in the same instruction
  - emits the shortfall
  - leaves the range's shorts holding the unpaid part as their existing `premium_receivable` carry

  An admin runs the documented incident path (pause → assess → public note → remediation) before unpausing.

#### 5. Ordering when both apply

**Liquidation first.** Force exercise on an insolvent account is refused (`TargetInsolvent`). A fee credited into an account that is simultaneously being liquidated would muddle both the bonus cap and the shortfall figure.

#### 6. Oracle

- Liquidation under **Q1 option A** (premium-only) reads **no price**. Its eligibility is price-independent, like everything in ADR-0003. Force exercise always reads the reference.
- The P4 read is a wrapper over `oracle::load_price_update` + `check_price`, with a **P4 staleness window** (Q4) tighter than the 60 s mint gate. It also requires `posted_slot` to lie within a bounded number of slots of `Clock::slot`, which closes the ADR-0004 "cherry-pick inside the window" hole without new state.
- Any oracle failure **refuses** the instruction (fail closed). It never touches the owner's own exits, which read no oracle (`oracle.rs:17-18`).

#### 7. Conservation and events

- Every move is between existing ledgers:
  - `free_usdc(owner) → range_vault` (premium, a real transfer, as in settle)
  - `free_usdc(owner) → free_usdc(liquidator)` (bonus, internal)
  - `free_usdc(exercisor) → free_usdc(exercisee)` (fee, internal)
- Both reconcile identities in `scripts/reconcile.mjs` must stay exact: `vault + Σ in_orca == Σ(free + locked)` and `range_vault == premium_pool + dust`.
- New events:
  - `LongLiquidated { market, owner, liquidator, perma_position, size, premium_paid, bonus, shortfall, paused }`
  - `LongForceExercised { market, owner, exercisor, perma_position, size, premium_paid, fee, reference_price, conf, publish_time }`

  The indexer's `/liquidations` is then populated from these, and the web client's refusal of a non-empty array is lifted in the same change.
- New errors are appended after `OracleDeviationTooHigh` (6040).

### Test vectors (names from the spec; amounts only after §Open questions are answered)

| Vector | Where | Asserts |
|---|---|---|
| `LIQ_SOLVENT_REJECT` | `risk.rs` unit + `tests/liquidation.ts` | Solvent at maintenance → `AccountSolvent`, nothing moves |
| `LIQ_INSOLVENT_OK` | same | Below maintenance → closes; bonus ≤ cap; premium paid first |
| `LIQ_SPOT_SPIKE_FAIL` | `tests/force-exercise.ts` (and `tests/liquidation.ts` if Q1 = B) | Spot moved, reference healthy → refused |
| `LIQ_STALE_ORACLE_FAIL` | same | Update older than the P4 window, or `posted_slot` too old → refused |
| `LIQ_PAUSE_INTERACTION` | `tests/liquidation.ts` | Allowed while paused; shortfall sets `is_paused` and emits `shortfall` |
| `FX_IN_RANGE_REJECT` | `tests/force-exercise.ts` | Reference inside the range (conf-widened) → refused |
| `FX_OOR_OK` | same | OOR both by reference and spot → closes; fee to exercisee; `available_short_liquidity` restored; the short can now burn |
| `FX_NEAR_RANGE_FEE` / `FX_FAR_RANGE_FEE` | unit fixtures in `docs/06-testing/FIXTURES-AND-VECTORS.md` | The fee schedule at the frozen points |
| `BOTH_CONSERVATION` | both suites + `reconcile.mjs` | Both identities exact after every liquidation / force |
| `SPOOF_POSITION_LIST` | both suites | Duplicate, foreign, closed, or missing long in the list → `MissingOpenLong`; target not in the list → refused |

### Open questions (human decisions — **must be answered before Accepted**)

| # | Question | Options / what is needed |
|---|---|---|
| Q1 | Account-value model | **A (recommended for P4 v1):** premium-only, as §1. No price on the liquidation path; small scope. **B:** price-valued account value (WSOL at `min(spot, price − conf)`, short P&L, long intrinsic). Needs a funded counterparty for intrinsic value; much larger, likely its own phase. |
| Q2 | Maintenance factor `m` and bonus | Value of `m` (0 < m < 1), the bonus share of remaining free USDC, and the per-account cap. |
| Q3 | Force fee schedule | Near / far points and the shape between them (e.g. linear in ticks from the boundary, with a floor). |
| Q4 | P4 staleness | Seconds (< 60) and the maximum `posted_slot` lag. |
| Q5 | Who may call | Permissionless for both, or an allowlisted keeper for liquidation first. Force exercise: anyone, or only a short in the same range. |
| Q6 | Pause | Confirm "allowed while paused" (§4) and auto-pause on shortfall, versus refusing both while paused. |

### Consequences (if Accepted as proposed)

- **Positive**:
  - The Fair "stuck long" is gone. Sellers can always recover pinned inventory.
  - No new ledger or stored aggregate: eligibility reuses `required_free_usdc` over the validated long list.
  - Under Q1 = A, oracle risk is confined to force exercise.
- **Negative, accepted**:
  - One long per call means an 8-long account needs up to 8 transactions.
  - Under Q1 = A, a long never pays or receives intrinsic value; force exercise is closure plus a fee, not a Panoptic-style exercise payout.
  - A shortfall halts the market until an admin acts.

### Not in P4

Multi-leg portfolio margin (P5), a non-Orca CLMM (P6), WSOL as margin unless Q1 = B, a PERMA oracle ring, Switchboard. Any Panoptic code: behaviour reference only; the code is BUSL and must not be copied.
