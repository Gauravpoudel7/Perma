# Component 09 (Risk & Solvency) — Phase 0 Feasibility

**Date**: 2026-09-20 · **Specs**: [`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md) (rewritten this pass), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md) · **Audit**: [`DOCS-SYNC-AUDIT-09.md`](DOCS-SYNC-AUDIT-09.md)
**Stack**: anchor-cli `1.2.0`, solana `3.0.0`, `orca_whirlpools_client` 8.0.0 (no `anchor` feature), `--arch v0` — unchanged.

## Verdict: **GO**

Gate conditions, each verified:

| Condition | State |
|---|---|
| `DOCS-SYNC-AUDIT-09.md` exists, every `docs/**/*.md` + `PRD.md` reviewed | ✅ 87 + 1 files; 11 P0 / 124 P1 / 82 P2 |
| Every P0 fixed or ADR-accepted | ✅ all 11 fixed (none needed acceptance) |
| Living-spec P1s fixed or residual-listed with owner | ✅ clusters A–N, P fixed; O + Part B + UI listed with owners |
| `09-risk-solvency.md` rewritten: formulas, params, gates, non-goals, unchecked DoD | ✅ |
| ADR-0003 accepted, Q2 and Q3 decided | ✅ Option A (no price); no PnL instruction |
| No historical `IMPL-*` report rewritten | ✅ two one-line "closed by 09" notes appended (`IMPL-06` residual #3, `IMPL-08` residual #6); nothing else touched |
| No invented features; no `cargo fmt` drive-by | ✅ |
| Links resolve | ✅ 0 broken relative links across 87 files |

---

## Q0 — What the audit found that changes the code plan

Three things the docs said that would have shaped wrong code, all now corrected in the specs and reflected in the design below:

1. **`08 §E` printed money.** The long-burn pseudocode credited intrinsic value with no counterparty; the short-burn pseudocode applied P&L on top of `close_short`'s already-realized `returned − locked`. Phase 1 therefore adds **no PnL step anywhere** and adds a regression test (R6) that a short burn moves exactly `returned − locked` and nothing else.
2. **The tree claimed a solvency gate already existed** (nine sites). It does not; the live withdraw gate cannot see accrued premium on open longs. This is the hole — and it is reachable today.
3. **TWAP was assumed in five places.** `orca_whirlpools_client` 8.0.0: zero matches for `observation` / `twap`; `Oracle` is adaptive-fee state. No price input is available, so none is used.

## Q1 — Scope

**In**: `Market.long_margin_horizon_slots` / `long_margin_buffer_usdc` (defaults at `create_market`); `UserCollateral.open_longs`; pure helpers `required_margin`, `projected_index`, `payable_if_settled_now`, `required_free_usdc`; `check_withdraw_allowed` body replaced (call site unchanged); `check_long_mint_allowed` replacing the `balance_b > 0` stub; open longs as remaining accounts with `count == open_longs`; errors `InsolventMint`, `MissingOpenLong`, `TooManyOpenLongs` appended; `tests/risk-solvency.ts`; harness margin-awareness.

**Out**: liquidation, force-exercise, any oracle/TWAP, PnL, admin setter (10), UI, components 10–11.

## Q2 — Price: Option A, with crate evidence

```
$ grep -rniE "observation|twap" ~/.cargo/registry/src/*/orca_whirlpools_client-8.0.0/src   → (no output)
Oracle { whirlpool, trade_enable_timestamp, adaptive_fee_constants, adaptive_fee_variables { last_reference_update_timestamp, last_major_swap_timestamp, volatility_reference, tick_group_index_reference, volatility_accumulator, .. }, reserved }
Whirlpool { .., liquidity, sqrt_price, tick_current_index, .. }   // spot only
```

Solvency reads no price. Spot stays display / range-gating. `OracleDeviationTooHigh` not added. Options B (PERMA tick ring) and C (Pyth) rejected in ADR-0003 with reasons.

## Q3 — PnL

None. Short realized LP result is `returned − locked` in `close_short` (shipped, 04/05). Long burn P&L = 0 (shipped, 08). `calculate_pnl` is neither implemented nor exposed as a view.

## Q4 — Margin, numeric

`required_margin(L) = ceil(horizon × rate × L × mult / PREMIUM_SCALE) + buffer`; defaults `1_000` slots / `1_000_000` µUSDC → **`L µUSDC + 1 USDC`** at the demo rate. Rounds up, `checked_mul`, `MathOverflow`. Short margin unchanged (locked spend). Demo values, not fair value.

## Q5 — Account model: remaining accounts + counter

Every open long for `(market, owner)` passed on `withdraw_collateral` and `mint_position(LONG)`; `Account::<PermaPosition>::try_from` + PDA re-derivation + field checks + dedupe + **`count == open_longs` both ways**. `MAX_OPEN_LONGS = 8`. Option B (running aggregate) rejected: a second ledger that goes stale every slot.

**Stale-index finding (design review):** `withdraw_collateral` does not run the poke prefix, so the stored index under-counts everything since the last crank. Fixed by projecting `current_index + (now − last_update_slot) × rate` on the stack; `premium_index` rides withdraw as an `UncheckedAccount`, deserialized only when `open_longs > 0` (it must exist then). Vector **R7** proves it.

## Q6 — Gates

```
required = premium_owed_usdc + Σ (payable_if_settled_now_i + required_margin(L_i))
withdraw : free_b − amount_b ≥ required                          else InsolventWithdrawal
long mint: inventory → open_longs < 8 → free_b ≥ required + margin(L_new) else InsolventMint → open_long
```

Short users: `open_longs == 0` → reduces to today's check. Short mint and `lock_collateral` stay non-long-aware (ADR-0003 consequence; not an extraction vector).

## Q7 — Transaction size

Nothing rides on short mint (1156 B, 76 B headroom — must measure byte-identical after). Withdraw base ≈ 10 accounts ≈ 450 B; +32 B per long → 8 longs ≈ 700 B. Long mint already carries the full `MintPosition` struct (~1100 B for a long? — **measure**; if a long with 7 existing longs exceeds 1232 B, `MAX_OPEN_LONGS` drops). Escalation if needed: a dedicated `check_solvency` instruction that writes a short-lived attestation — **not** planned unless measurement forces it.

## Q8 — Tests at demo parameters (design review finding, user decision)

At `L µUSDC + 1 USDC` margin the `position-long.ts` "hog" test (mints all availability) fails on a second pass because `settle-premium.ts` leaks a 100e6 seed short per run. **Decision: keep 1,000 slots, fix the harness** — seed shorts burned in `after()`, helpers read `Market.long_margin_*` and top up accordingly, the hog test caps at what margin allows, every withdraw helper passes open longs unconditionally. The proof is "two forward passes + reverse on one ledger", which is exactly the case that broke.

## Q9 — Layout change

`Market` +16 B, `UserCollateral` +2 B → **every existing account stops deserializing; `--reset` is mandatory.** `tests/factory.ts` default assertions and every `UserCollateral` fixture in unit tests gain the new fields.

## Vectors

R1–R9 as listed in `09-risk-solvency.md` §Test Cases, plus unit tests for margin round-up / overflow, projection == `update_index`, no-mutation, sum, and counter `checked_sub`.

## Files to touch (Phase 1)

`state.rs`, `errors.rs`, `premium.rs`, `risk.rs`, `position.rs`, `lib.rs`; `tests/factory.ts`, `tests/collateral.ts`, `tests/position-long.ts`, `tests/settle-premium.ts`, new `tests/risk-solvency.ts`; `scripts/measure-position.mjs`, `scripts/reconcile.mjs`; then `IMPL-09-RISK-SOLVENCY-REPORT.md`, `09` DoD ticks, README, RELEASE-GATE S4, ERROR-CATALOG §6 → live.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
