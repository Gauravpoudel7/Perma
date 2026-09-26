# ADR-0006: Price premium and margin on value, not on Orca liquidity

> Prototype. Not audited. Single pool. Not production mainnet risk capital.

| Field | Value |
|---|---|
| Status | **Accepted** (2026-09-26), with the owner's answers to Q1–Q5 below. Built on branch `p5`; Solana-devnet upgrade pending an explicit "GO upgrade". |
| Supersedes | The open question in [`OPEN-QUESTION-premium-per-liquidity.md`](OPEN-QUESTION-premium-per-liquidity.md) |
| Touches | `tick_math.rs` (new), `premium.rs`, `risk.rs`, `lib.rs` (`set_premium_params`, the 32-tick minimum), `errors.rs`, `state.rs` defaults; `apps/web/src/lib/tickMath.ts` (new), `solvency.ts`, the trade ticket; `tests/pricing.ts`, `tests/value-pricing.ts` (new) |
| Related | [ADR-0002](ADR-0002-premium-accounting.md) (premium accounting), [ADR-0003](ADR-0003-fair-mvp-risk-model.md) (margin), [ADR-0004](ADR-0004-oracle-and-price-aware-risk.md) (no price on exit paths), [ADR-0005](ADR-0005-force-exercise-and-liquidation.md) (maintenance, force-exercise fee) |

## Problem

A long pays premium on the raw Orca liquidity `L` it borrows. It does not pay on what that liquidity is worth. Measured on main `1c77932`:

- **Index.** `update_index` adds `elapsed × premium_rate` to one global index (`programs/perma/src/premium.rs:36`).
- **What a long owes.** `accrue_long` adds `d_index × L × premium_multiplier` to `accrued_scaled` (`premium.rs:98`, the multiply at `:105`). `payable_from` floors this to µUSDC and carries the remainder (`:125`). The read-only projection `payable_if_settled_now` rounds up (`:174`). At the defaults (`premium_rate = 1_000_000`, `premium_multiplier = 1_000`, `state.rs:42,44`), a long owes **`L / 1000` µUSDC per slot**.
- **What shorts earn.** `poke_range` computes the range's inflow `d_index × total_long_liquidity × mult / 1e12` (`premium.rs:71`) and spreads it over `total_short_liquidity` as a Q64 value per unit of short `L` (`:79`). `claimable_for` / `claim_short_amount` pay it out, capped by `premium_pool`, with any unpaid rest carried in `premium_receivable` (`:134`, `:205`).
- **Cash.** `settle_premium` (`lib.rs:834`) runs `settle_long_cash` (`lib.rs:1586`) or `settle_short_cash` (`lib.rs:1648`). A long burn pays through `pay_long_premium_cash` (`lib.rs:2054`).
- **Margin.** `required_margin_with` = `⌈horizon × rate × L × mult / 1e12⌉ + buffer` (`risk.rs:67`, multiply at `:74`). At the defaults this is `L` µUSDC plus 1 USDC. `required_free_usdc` sums owed premium plus margin over all open longs (`risk.rs:139`, via `requirement_parts` `:152`). It gates mint (`check_long_mint_allowed`, `risk.rs:283`, called from `mint_long_inner`, `lib.rs:2216`) and withdraw (`check_withdraw_allowed`, `risk.rs:253`). `validate_risk_params` bounds it at `MARGIN_LIQUIDITY_BOUND = 2^52` (`risk.rs:102`).
- **P4.**
  - Maintenance is `owed + ⌈0.75 × Σ margin⌉` (`maintenance_free_usdc`, `risk.rs:196`; `MAINT_MARGIN_BPS`, `:172`).
  - The liquidation bonus is capped by 0.75 × the closed long's margin (`liquidation_bonus`, `:214`).
  - The force-exercise fee starts from 100 slots of premium on `L` (`force_exercise_fee`, `:223`).
  - The shortfall pause floor is 1 USDC (`:179`).
  - Callers: `liquidate_long` (`lib.rs:1040`), `force_exercise` (`lib.rs:1099`), and the shared close path `close_long_for_caller` (`lib.rs:2157`, which runs `poke_range` and `accrue_long` at `:2177-2178`).
- **Web mirror.** `requiredMargin` and `estPremiumPerHour` (`apps/web/src/lib/solvency.ts:34`, `:53`) and `maxAffordableLiquidity` (`:159`) copy the formulas above. The ticket turns SOL/USDC into `L` with `liquidityForAmount` (`liquidityMath.ts:93`, via `ticketSize.ts:31`). `PremiumPreview.tsx:32` and `useOpenPosition.ts:272-274` show the result.

**Why narrow ranges cost more per SOL.** `L` is not value.

In concentrated liquidity, one unit of `L` holds tokens worth about `Δ√P = √P_upper − √P_lower`: USDC for a range below spot, SOL for a range above, and a mix for a range around spot. A narrow range has a tiny `Δ√P`, so it takes a huge `L` to hold the same SOL. Premium and margin are charged per unit of `L`, so the narrow range pays proportionally more. Going from 2048 ticks to 8 ticks multiplies `L`, and therefore premium, by about **250×** for the same dollar size.

### Today, measured

These numbers come from `apps/web/scripts/premium-table.mts` (a throwaway script). It uses the app's own `amountsForLiquidity`, `estPremiumPerHour` and `requiredMargin`, the live Market parameters read from Solana-devnet (rate 1,000,000, mult 1,000, horizon 1,000 slots, buffer 1 USDC), and spot tick −21206 (119.97 USDC/SOL). Each range is centred on spot. "Value" is the long's USDC value at spot.

| Range (ticks, USDC/SOL) | Size | `L` | Value (USDC) | Premium/h (USDC) | Margin (USDC) | Premium per hour, % of value |
|---|---|---|---|---|---|---|
| 8 (119.95–120.04) | 0.001 SOL | 866,077,165 | 0.120 | 7,795 | 867 | 6.5 million % |
| 8 | 0.1 SOL | 86,607,716,540 | 12.00 | 779,000 | 86,600 | 6.5 million % |
| 8 | 1 SOL | 866,077,165,400 | 119.97 | 7,790,000 | 866,000 | 6.5 million % |
| 32 (119.76–120.14) | 0.001 / 0.1 / 1 SOL | 2.17e8 / 2.17e10 / 2.17e11 | 0.12 / 12.0 / 120 | 1,949 / 195,000 / 1.95e6 | 218 / 21,700 / 217,000 | 1.6 million % |
| 128 (119.18–120.72) | 0.001 / 0.1 / 1 SOL | 5.42e7 / 5.42e9 / 5.42e10 | 0.12 / 12.0 / 120 | 488 / 48,800 / 488,000 | 55.2 / 5,422 / 54,200 | 407,000 % |
| 512 (116.92–123.06) | 0.001 / 0.1 / 1 SOL | 1.36e7 / 1.36e9 / 1.36e10 | 0.12 / 12.0 / 120 | 123 / 12,300 / 123,000 | 14.6 / 1,363 / 13,600 | 102,000 % |
| 2048 (108.27–132.88) | 0.001 / 0.1 / 1 SOL | 3.47e6 / 3.47e8 / 3.47e9 | 0.12 / 12.0 / 120 | 31.2 / 3,123 / 31,200 | 4.47 / 348 / 3,471 | 26,000 % |

The OPEN-QUESTION note measured 481,600 USDC/h for 1 SOL on the 116.54–118.05 range at spot 115.81. That matches the 128-tick row here (488,000/h); the small gap is the different spot and centring.

## Options

Every option is measured with the same script. Options (a) and (b) use the same proposed rate, **0.01 % of notional per hour** (≈ 87.6 % APR, see Q1), so the two can be compared directly.

### (a) A rate on the long's USDC value at the current spot

`premium per slot = k × value_at_spot(L, ticks, spot)`

| Any range | 0.001 SOL | 0.1 SOL | 1 SOL |
|---|---|---|---|
| Premium/h | 0.000012 | 0.0012 | 0.0120 |
| Margin at a 1-day horizon | 1.0003 | 1.0288 | 1.2879 |

- **Upside:** the exact value, for every range and every spot.
- **Downsides:**
  - Accrual is lazy, since a checkpoint moves only when someone touches the position. So the price used for a whole period is the price at the moment someone settles. A long (or a friendly cranker) can wait for a spot move that makes its range cheap, then settle. Shorts could do the opposite. That is exactly the timing game ADR-0002 closed.
  - Every premium path (settle, burn, withdraw, liquidate) would need the pool account and a price read, which puts a price dependency on exit paths. ADR-0004 forbids that, so an oracle or pool outage would trap funds.
  - `poke_range` spreads one inflow over all shorts. With a spot-dependent factor, fairness across checkpoints needs a time-weighted price, and Orca has no TWAP.

### (b) Keep `L` accounting, but scale it by the range's value per unit of `L` *(recommended)*

`v(range) = √P_upper − √P_lower` in raw units (µUSDC per unit of `L`). It depends **only on the two ticks**, and it is exactly Orca's `amount_b` formula: the USDC one unit of `L` holds once price is above the range.

- **Long:** `accrued_scaled += d_index × L × v × mult`
- **Range inflow for shorts:** `d_index × total_long_liquidity × v × mult / 1e12`
- **Margin:** `⌈horizon × rate × L × v × mult / 1e12⌉ + buffer`

| Range | Size | Notional `v·L` (USDC) | `v·L` ÷ value at spot | Premium/h | Margin, horizon 1,000 slots | Margin, horizon 1 day |
|---|---|---|---|---|---|---|
| 8 | 0.001 / 0.1 / 1 SOL | 0.120 / 12.00 / 120.0 | 1.0002 | 0.000012 / 0.0012 / 0.0120 | 1.0000 / 1.0001 / 1.0013 | 1.0003 / 1.0288 / 1.2880 |
| 32 | 0.001 / 0.1 / 1 SOL | 0.120 / 12.00 / 120.0 | 1.0003 | 0.000012 / 0.0012 / 0.0120 | 1.0000 / 1.0001 / 1.0013 | 1.0003 / 1.0288 / 1.2880 |
| 128 | 0.001 / 0.1 / 1 SOL | 0.120 / 12.02 / 120.2 | 1.0015 | 0.000012 / 0.0012 / 0.0120 | 1.0000 / 1.0001 / 1.0013 | 1.0003 / 1.0288 / 1.2884 |
| 512 | 0.001 / 0.1 / 1 SOL | 0.121 / 12.07 / 120.7 | 1.0063 | 0.000012 / 0.0012 / 0.0121 | 1.0000 / 1.0001 / 1.0013 | 1.0003 / 1.0290 / 1.2898 |
| 2048 | 0.001 / 0.1 / 1 SOL | 0.123 / 12.31 / 123.1 | 1.0262 | 0.000012 / 0.0012 / 0.0123 | 1.0000 / 1.0001 / 1.0014 | 1.0003 / 1.0295 / 1.2955 |

- **Same size costs the same.** A 1 SOL long costs about 0.012 USDC/h on any width. The worst spread in this table is 2.6 %, on a 2,048-tick range.
- **No price is read.** `v` comes from ticks the position already stores. Exit paths stay price-free (ADR-0004), and there is no settle-timing game.
- **Shorts are paid fairly.** All longs and shorts in a range share its ticks, so `v` is one constant per range. The inflow and each short's pro-rata share both scale by the same `v`. Conservation (Σ long payments = Σ short entitlements + dust) holds exactly as today (ADR-0002).
- **Where it is off:**
  - `v·L` is the value **at the top of the range**. It equals the value at spot when the range is at or below spot (all USDC).
  - For a range above spot (all SOL), it overstates value by `√(P_lower·P_upper) / P_spot`. A range centred 20 % above spot is charged about 20 % too much. That is conservative for shorts, and in the ticket it becomes a visible "priced at range top" note.

### (c) Premium from the fees the borrowed liquidity would have earned (Panoptic "streamia")

Panoptic charges a long the Uniswap fees its liquidity would have collected while in range, times a **spread** of 1× to 3.25× that rises with utilization ([Streamia docs](https://panoptic.xyz/docs/product/streamia), [Spread](https://panoptic.xyz/docs/product/spread), [Streamia 101](https://panoptic.xyz/research/streamia-101)). On Orca this means reading `fee_growth_inside` from the range's tick arrays on every poke.

This table uses the live pool (fee 0.05 %, active `L` 6.35e9), spread 1×, and an assumed 10,000 USDC/day traded inside the range:

| Range | Premium/h at 0 volume (devnet today) | Premium/h for 0.001 / 0.1 / 1 SOL at 10k USDC/day | Premium per hour, % of value |
|---|---|---|---|
| 8 | 0 | 0.0284 / 2.84 / 28.4 | 23.7 % |
| 32 | 0 | 0.0071 / 0.71 / 7.11 | 5.9 % |
| 128 | 0 | 0.0018 / 0.18 / 1.78 | 1.5 % |
| 512 | 0 | 0.00045 / 0.045 / 0.45 | 0.37 % |
| 2048 | 0 | 0.00011 / 0.011 / 0.11 | 0.09 % |

- **It is still priced per `L`.** Fee growth is per unit of liquidity whatever the width, so the cost per dollar still scales about 4× for every 4× narrower range. Panoptic does this on purpose: a narrow range behaves like a short-dated at-the-money option, with more gamma per dollar, so it should cost more. It reduces the problem, but does not remove it.
- **On devnet it pays shorts nothing,** because the pool barely trades.
- **It needs tick-array reads in every premium path,** which makes the transactions bigger.
- The 10k/day figures also assume the long's `L` does not dilute the pool, and the 8-tick 1 SOL long alone is 136× the pool's active `L`.

## Decision (accepted 2026-09-26)

**Adopt (b).** Every premium and margin term is scaled by the per-range value `v(tick_lower, tick_upper) = √P_upper − √P_lower`, and the rate is a share of notional. The owner answered the open questions as follows.

| # | Question | Decision |
|---|---|---|
| Q1 | Rate level | `premium_rate = 11_111`, `premium_multiplier = 1`: 0.01 % of notional per hour (9,000 × 11,111 / 1e12 ≈ 1.0e-4). Set by a new admin-only `set_premium_params`, bounded by `MAX_PREMIUM_RATE = 1_000_000` and `MAX_PREMIUM_MULTIPLIER = 1_000`. |
| Q2 | Width risk | A **minimum range width of 32 ticks** for new longs and shorts, as a program constant (`risk::MIN_RANGE_TICKS`), with no stored field. Error `RangeTooNarrow` (6044). The web ticket blocks and explains a narrower range. |
| Q3 | Force-exercise fee | **0.1 % of the long's notional** (`FX_FEE_BPS = 10`, rounded up, floor 1 µUSDC), on the same `v·L` basis. It no longer halves with distance. |
| Q4 | Margin horizon | **1 day = 216,000 slots**, through the existing `set_market_risk_params`. |
| Q5 | Tick → √P | **Ported** from Orca's `tick_math.rs` (Apache-2.0) into `programs/perma/src/tick_math.rs`. The constants are copied mechanically from the source file and checked against Orca's own exact-bit vectors and edge values. The 256-bit arithmetic is a small in-crate `U256`, with overflow tests. No new dependency. |

### As built

1. **`tick_math.rs`:**
   - `sqrt_price_x64(tick)` is Orca's table, refusing ticks outside ±443,636.
   - `range_value_q64(lo, hi)` gives `v`; `notional_q64` gives `L × v` as a `U256`; `notional_usdc` gives `⌊L·v / 2^64⌋`.
   - `U256` provides a full 128×128 product, a checked multiply by u128, a shift with optional round-up, and division by u64.
2. **`premium.rs`:** `scaled_charge(d_index, mult, L, lo, hi, ceil)` = `d_index × mult × L × v / 2^64` in scaled units.
   - A long's own charge (`accrue_long`, `payable_if_settled_now`) rounds **up**.
   - A range's inflow to its shorts (`poke_range`) rounds **down**.

   So longs always pay at least what shorts are credited. The round-up costs a long at most 1e-12 µUSDC per accrual, so settle frequency stays neutral for any realistic number of cranks. `payable_from`'s floor-with-carry is unchanged.
3. **`risk.rs`:**
   - Margin: `required_margin(market, L, lo, hi) = ⌈horizon × rate × mult × L·v / (2^64 × 1e12)⌉ + buffer`.
   - `MARGIN_NOTIONAL_BOUND = 2^52 µUSDC` (≈ 4.5 bn USDC) replaces the L bound. `mint_position(LONG)` refuses a larger long.
   - Both setters (`validate_risk_params`, `validate_premium_params`) prove that `8 × margin(bound)` fits in `u64`. At the ceilings, a 1-day horizon fits and about 2.4 days is the limit.
   - `force_exercise_fee(L, lo, hi)` is 0.1 % of notional.
4. **`lib.rs`:**
   - `mint_position` refuses ranges narrower than 32 ticks, before anything else runs.
   - `set_premium_params(rate, mult)`: admin only (`factory::require_admin`), bounded (`InvalidPremiumParams`, 6045). It advances the premium index at the **old** rate first, so the change only prices later slots. If no mint has created the index yet, there is nothing to advance. It emits `MarketPremiumParamsSet`.
5. **`state.rs` defaults:** `PREMIUM_RATE = 11_111`, `PREMIUM_MULTIPLIER = 1`, `LONG_MARGIN_HORIZON_SLOTS = 216_000`. A fresh market therefore matches devnet after rollout.

### Measured after the change

These numbers come from `apps/web/scripts/premium-table.mts`, which calls the web mirror functions (`solvency.ts` and `tickMath.ts`). Those are integer-identical to the program: the parity tests are `apps/web/test/tickMath.test.ts` and `solvency.test.ts` against the Rust vectors. Spot is 119.97 USDC/SOL, and each range is centred on spot.

| Range (ticks) | Size | Before: premium/h | Before: margin | After: premium/h | After: margin (1 day) | After: FX fee |
|---|---|---|---|---|---|---|
| 8 | 0.001 / 0.1 / 1 SOL | 7,795 / 779,000 / 7,790,000 | 867 / 86,609 / 866,000 | **refused** (< 32 ticks) | — | — |
| 32 | 0.001 / 0.1 / 1 SOL | 1,949 / 195,000 / 1,950,000 | 218 / 21,659 / 217,000 | 0.000012 / 0.0012 / **0.0120** | 1.0003 / 1.0288 / **1.2880** | 0.00012 / 0.012 / 0.120 |
| 128 | 0.001 / 0.1 / 1 SOL | 488 / 48,789 / 488,000 | 55.2 / 5,422 / 54,211 | 0.000012 / 0.0012 / **0.0120** | 1.0003 / 1.0288 / **1.2884** | 0.00012 / 0.012 / 0.120 |
| 512 | 0.001 / 0.1 / 1 SOL | 123 / 12,256 / 123,000 | 14.6 / 1,363 / 13,619 | 0.000012 / 0.0012 / **0.0121** | 1.0003 / 1.0290 / **1.2898** | 0.00012 / 0.012 / 0.121 |
| 2048 | 0.001 / 0.1 / 1 SOL | 31.2 / 3,123 / 31,230 | 4.47 / 348 / 3,471 | 0.000012 / 0.0012 / **0.0123** | 1.0003 / 1.0295 / **1.2955** | 0.00012 / 0.012 / 0.123 |

All figures are in USDC.

### `v·L` compared with the value at spot, for ranges away from spot

`v·L` prices a range at the top of its range. For a range below spot (all USDC) that is its exact value. For a range above spot (all SOL) it is higher, by about `√(P_lower·P_upper) / P_spot`:

| Range | 128 ticks wide | 2048 ticks wide |
|---|---|---|
| starts 5 % above spot | 1.0565 | 1.1630 |
| starts 10 % above spot | 1.1067 | 1.2182 |
| starts 20 % above spot | 1.2075 | 1.3292 |
| ends 5 % below spot | 1.0000 | 1.0000 |
| ends 10 % below spot | 1.0000 | 1.0000 |
| ends 20 % below spot | 1.0000 | 1.0000 |

So a long on a range 20 % above spot pays 21–33 % more than its value at spot would imply. This errs in the shorts' favour, and the ticket shows the notional it is priced on.

### Account layout

- **No stored layout change.** `Market`, `GlobalPremiumIndex`, `RangePremiumState`, `PermaPosition`, `UserCollateral` and `GlobalConfig` keep every field.
- **Meanings change:** `accrued_scaled` becomes "scaled µUSDC including `v`". `acc_premium_per_short_q64` stays µUSDC per unit of short `L`. `premium_rate` / `premium_multiplier` are now read against notional.
- **No account migration is needed, but there is a rollout gate:** a long that is open during the upgrade would have its unsettled period repriced with `v`. So the upgrade requires **zero open longs**: pause, settle and close every long, then check `total_long_liquidity == 0` in every `RangePremiumState`. Open shorts are safe; their claims up to the upgrade slot are already recorded in the accumulator.
- **New instruction:** `set_premium_params`, with its accounts struct `SetMarketPremiumParams` (admin, global config, market, and the premium index as a seeds-checked account). It adds to the IDL but not to account layouts. There is also one new event, `MarketPremiumParamsSet`, and two new errors (6044, 6045).

## Consequences

- **Positive:**
  - A 1 SOL long costs about 0.012 USDC/h on any width (today it is 31,200 to 7,790,000 USDC/h), and the ticket's premium figure becomes a number a trader can use.
  - No oracle or price on any premium path.
  - Conservation and the short pro-rata split are unchanged.
  - No layout migration.
- **Negative, accepted or open:**
  - **Narrow ranges get cheaper per dollar than their risk warrants.** A narrow range concentrates price exposure (gamma), and (b) ignores that. The 32-tick minimum (Q2) caps the worst case; a width curve remains a later option.
  - Ranges above spot are over-charged by up to `√(P_l·P_u)/P_spot`.
  - **The force-exercise fee is now 0.1 % of notional** (Q3), and ADR-0005 §2/§3 are amended to match. It no longer depends on how far out of range the pool is.
  - **Liquidation still reads no price.** Maintenance keeps its form, but margins shrink toward the 1 USDC buffer, so small longs are mostly guarded by the buffer. The 1 USDC pause floor still makes sense.
  - A ported tick → √P table and a hand-rolled `U256` are new math to audit. Both carry Orca's vectors and overflow tests.
  - Localnet suites that need visible accrual in a few slots switch the market to the ceilings (`tests/pricing.ts`: 0.1 % of notional per slot, 1,000-slot horizon) and restore the shipped values afterwards.

## Test plan (executed on `p5`)

- **Unit, `cargo test -p perma --lib`: 92 pass.**
  - `tick_math`: Orca's 40 exact-bit vectors on both branches; both edges and the out-of-range refusals; a strictly increasing sweep across the whole domain; agreement with `1.0001^(t/2)` to 1e-9; `v` / notional for the devnet range; and `U256` multiply, shift, divide and overflow.
  - `premium`: an independent plain-u128 reference; equal notional owes equal premium on 32- and 2048-tick ranges; conservation (claims + dust = paid) for V2–V5; crank neutrality within 1 µUSDC over 100 cranks.
  - `risk`:
    - margin = ⌈notional⌉ + 1 USDC at test pricing, and it is width-neutral
    - rounding up
    - overflow as an error
    - the shipped defaults pass the bound
    - the 8-long sum guard, and the 1-day horizon at the ceilings
    - `validate_premium_params` refuses 0, above-ceiling values, and past-bound pairs
    - the notional bound at mint
    - the P4 vectors (maintenance, bonus, dust floor) unchanged when re-based on notional
    - the FX fee at 0.1 %
- **Localnet, fresh isolated validator with the full §4.2 list plus `tests/value-pricing.ts`: 138 passing, 0 failing.**
  - `set_premium_params` refuses a non-admin (`Unauthorized`) and out-of-bounds values (`InvalidPremiumParams`), writing nothing. The index advances at the old rate, to the exact slot.
  - `RangeTooNarrow` fires for a short and a long on a 24-tick range.
  - Equal-notional longs on 80- and 2008-tick ranges each pay about 1,000 µUSDC per slot, within 3 %.
  - Liquidation L1–L5 and force-exercise run under the new pricing.
- **Web, `apps/web`:** 161 tests pass, including the Orca vectors in TypeScript and the parity vectors. Typecheck, lint, check-copy and build all pass. The ticket shows "Pick a range at least 32 ticks wide (4 tick spacings)." for a narrower range.
- **Devnet smoke:** after the upgrade.

## Rollout

1. Build and pass all tests on a branch, then an isolated localnet run.
2. **Layout check** against the live program: every account decodes unchanged under the new IDL (as for P4).
3. **Zero-open-longs gate:** pause the market; settle and close or liquidate every long; check that every range's `total_long_liquidity` is 0.
4. Upgrade Solana-devnet (the `solana program deploy` runbook, with a buffer resume if needed), then confirm the dumped ELF hash.
5. `yarn set-premium-params 11111 1`, then `yarn set-risk-params 216000 1000000` (`apps/web/scripts/pause-market.ts`), then unpause if paused.
6. Web: sync the IDL; update `solvency.ts`, `ticketSize.ts`, `PremiumPreview` and the Review sheet, including the "priced at range top" note for ranges above spot.
7. Smoke on devnet; update the RELEASE-GATE and COPY-DECK rows.

## Follow-ups

- A width curve (`k × (1 + W₀/width)`) instead of the flat 32-tick minimum, if narrow ranges prove under-priced in practice.
- Pricing ranges above spot at their value at spot rather than at their top would need a price read; out of scope for as long as exits must stay price-free (ADR-0004).
