# IMPL-10-PAUSE-ADMIN-REPORT

**Status**: Shipped. **Date**: 2026-09-21. **Spec**: [`10-pause-admin.md`](../02-mvp-components/10-pause-admin.md) · **Feasibility**: [`IMPL-10-FEASIBILITY.md`](IMPL-10-FEASIBILITY.md) (GO) · **Prompt**: [`CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md`](../prompts/CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md)

## 1. Shipped surface

| Piece | Where |
|---|---|
| `pause_market()` / `unpause_market()` — admin-only, idempotent, emit only on a real transition | `programs/perma/src/lib.rs` (`SetMarketPause` accounts: `admin` signer, `global_config`, `market` mut; no payer) |
| `set_market_risk_params(long_margin_horizon_slots, long_margin_buffer_usdc)` — admin-only, writes the two existing ADR-0003 fields in place after overflow re-validation | `lib.rs` (`SetMarketRiskParams`), `risk.rs` |
| `factory::require_admin(config, admin)` — one admin check, reused by `create_market` (which now calls it first; same order and errors as before) and the three new ixs | `factory.rs` |
| `risk::required_margin_with(horizon, rate, mult, buffer, L)` — the margin body, extracted verbatim; `required_margin(market, L)` is a one-line delegate | `risk.rs` |
| `risk::MARGIN_LIQUIDITY_BOUND = 1 << 52` and `risk::validate_risk_params` | `risk.rs` |
| `PermaError::InvalidRiskParams` — appended last, code **6034** (`0x35`) | `errors.rs` |
| Events `MarketPauseSet { market, admin }`, `MarketPauseCleared { market, admin }`, `MarketRiskParamsSet { market, admin, long_margin_horizon_slots, long_margin_buffer_usdc }` | `lib.rs` events block |
| `tests/pause-admin.ts` — 17 cases | root tests, appended last in the release gate |
| UI: `DepositForm` no longer `allowWhilePaused`; `errors.ts` gains `InvalidRiskParams` copy and a non-settle-specific `Unauthorized`; `yarn pause-market` / `unpause-market` / `set-risk-params` (`apps/web/scripts/pause-market.ts`) | `apps/web` |
| IDL resynced (`apps/web/src/idl/perma.{json,ts}`): 17 instructions, 3 new events, 35 errors | `apps/web/src/idl` |

**Account layouts: unchanged.** `state.rs` is not touched. `Market.is_paused` and the two risk fields are the existing bytes; existing `Market` PDAs on a redeployed localnet keep `is_paused = false` until an admin pauses; the setter overwrites in place, no realloc. `GlobalConfig` gained nothing — `pause_global` is deferred because it would resize the singleton.

## 2. Guard surgery (Exit Guaranteed)

The live guard set before this component would have *trapped* open interest the moment the flag flipped. The corrected matrix, implemented exactly and proven live:

| Instruction | While `Market.is_paused` | Change |
|---|---|---|
| `mint_position` (both legs) | **Reject** `MarketPaused` | kept |
| `deposit_collateral` | **Reject** | kept |
| `lock_collateral` | **Reject** | kept |
| `adapter_open_position` / `adapter_add_liquidity` | **Reject** `MarketPaused` | **error code fixed** (was `WhirlpoolNotAllowlisted`) |
| `burn_position` | **Allow** | **guard removed** |
| `settle_premium` | **Allow** | **guard removed** |
| `withdraw_collateral` | **Allow** (still 09 solvency) | **guard removed** |
| `unlock_collateral` | **Allow** (still `PositionsOutstanding`) | **guard removed** |
| `validate_short_range`, `adapter_close_position`, `adapter_remove_liquidity` | Allow | unchanged (never checked) |
| admin ixs, `create_market` | Allowed / unchanged | — |

Nothing else in those handlers moved: no premium math, no range-vault conservation, no Orca CPI account metas or order, no `mint_position` / `burn_position` / `settle_premium` account lists, no ADR-0003 withdraw remaining-accounts rule.

## 3. `set_market_risk_params` — the ADR-0003 forward requirement

ADR-0003 §"Forward requirement for component 10": the setter must re-validate `horizon × premium_rate × premium_multiplier` against a maximum-L bound, because an overflowing `required_margin` at *withdraw* time locks funds. Design:

- **One implementation of the formula.** `required_margin_with` holds the exact prior body (same checked ops, same order, same `MathOverflow`s); `required_margin` delegates. The three pre-existing unit tests plus a new equality test pin the refactor.
- **`validate_risk_params(horizon, buffer, rate, mult)`** rejects `InvalidRiskParams` when: `horizon == 0` (margin collapses to the buffer); `buffer == 0` (the ADR's flat floor); `required_margin_with(…, MARGIN_LIQUIDITY_BOUND)` errs; or `margin × MAX_OPEN_LONGS > u64::MAX` — the **sum guard**, mirroring `required_free_usdc`'s summation over up to 8 longs, which is the actual brick vector. Monotone in L, so passing at the bound covers every smaller position.
- **Bound `2^52 ≈ 4.5e15`**: ~4.5e7× the largest demo position (`SHORT_L = 1e8`); ≈ $800k in the narrowest 8-tick band of a SOL/USDC pool at ~$200. Its trade-off, documented on the constant: `8 × (horizon × rate × mult / 1e12) × 2^52 ≤ u64::MAX` ⇒ at the demo rate/multiplier the admissible **horizon ≤ ~512_000 slots (~2.4 days)**. Raising the bound tightens that ceiling; it is a conscious choice, not a limit discovered later.
- **Defaults pass with headroom**: `total = 4_503_599_628_370_496` (4096× under `u64::MAX`), 8-fold sum `36_028_797_026_963_968` (512× under). `horizon = 1_000_000` fails only at the sum guard (single margin fits, ×8 does not) — the exact case the ADR names. `horizon = u64::MAX` fails at the product chain. All rejections surface as `InvalidRiskParams`, never a bare `MathOverflow`.

## 4. Verification

| Gate | Result |
|---|---|
| `yarn test:unit` (`cargo test -p perma --lib`) | **66 passing** (60 + 6 new in `risk::tests`) |
| `anchor build --arch v0` | clean; `.so` 570 720 B (was 560 400), upgraded in place on localnet |
| Release gate §4.2, 9 suites on one fresh ledger | pass 1: 93 passing (after fixing one assertion in the new suite — see §6); pass 2 same ledger: **93 passing**; reversed order on a fresh ledger: **93 passing, 0 failing** |
| `tests/pause-admin.ts` alone | 17/17, including the Q1 matrix cell-by-cell, `MarketPaused`-not-`WhirlpoolNotAllowlisted` for the adapter, idempotent pause/unpause, and all four `InvalidRiskParams` rejections |
| `apps/web`: `yarn typecheck`, `yarn test` (28), `yarn check-copy`, `yarn build`, `yarn test:e2e` (38 passed, 4 intentionally skipped) | all green |
| Live loop on the validator | `yarn pause-market` → `verify-live` shows `isPaused: true` → `yarn unpause-market` → `yarn set-risk-params 0 1` → `InvalidRiskParams` → `set-risk-params 2000 2000000` then back to `1000 1000000`, each read back |
| Tx sizes (Q6, measured in the suite) | `pause_market` 244 B, `unpause_market` 244 B, `set_market_risk_params` 260 B |

`cargo clippy -- -D warnings` (`yarn lint`) was **already red before this component** on the current toolchain — 24 pre-existing `unexpected cfg anchor-debug` (Anchor's `#[derive(Accounts)]` macro on every existing struct) and `doc_lazy_continuation` hits in old comments — and `cargo fmt --check` already differs on untouched `adapter.rs`. None originate in this change; per the no-drive-by rule they were left alone and are listed as a residual.

## 5. Test-suite design notes

- **No shared helpers** is the repo convention; `pause-admin.ts` copies the minimal set from `risk-solvency.ts` / `collateral.ts` / `adapter-liquidity.ts`.
- **Order-independence** (the gate runs twice, then reversed): `before()` heals a market a crashed run left paused or with non-default params; `after()` unconditionally unpauses, restores defaults, burns every long and short the suite opened, and asserts `totalLongLiquidity == 0` on the demo range.
- **Unlock is proven by a second wallet.** `unlock_collateral`'s own gate is `open_positions == 0` *per owner*, and other suites legitimately leave the provider wallet's shorts open, so the position-free `stranger` is the one who locks (while unpaused) and unlocks (while paused). The provider wallet then proves the negative: with shorts open, unlock fails `PositionsOutstanding`, not `MarketPaused`.
- **Adapter under pause needs no Orca fixture.** The pause check is the first line of both harness handlers; `adapter_open_position` fails before Orca and the `init` rolls back (asserted); `adapter_add_liquidity` is called against the product-path seed short, whose `PermaPosition` satisfies the accounts constraints, and fails before `reject_harness_if_longs` and the CPI.

## 6. What the run surfaced

1. **A dirty ledger, not a code fault.** The first gate attempt on the validator left over from the UI session failed in four *prior* suites with `totalLongLiquidity == 10_000_000` (a long minted by `verify-mint-long.ts` and never burned) and `HarnessPathUnavailable`. Per RELEASE-GATE §3 the gate needs a fresh ledger; restarted, redeployed, re-ran.
2. **One assertion bug in the new suite.** I first asserted `open_positions` drops by 2 after burning a long and a short; `open_positions` counts shorts only (it backs locked collateral — longs live in `open_longs`). Fixed to `−1` plus a check that the long's account is gone. The burns themselves succeeded under pause on the first run.
3. **`tsx` scripts read env from the shell**, same as the existing `verify-*` scripts — `README.md` now says to `source .env.local` first.

## 7. Residuals (explicit)

- `pause_global` — deferred; needs a `GlobalConfig` resize + migration. With one allowlisted market, `pause_market` is the global pause.
- Squads / multisig on the admin key — post-MVP; today `require_keys_eq!` against `GlobalConfig.admin`.
- Component 11 — the three new events are emitted but nothing indexes them yet.
- `MARGIN_LIQUIDITY_BOUND` caps the admissible horizon at ~2.4 days at the demo rate; if a longer horizon is ever wanted, lower the bound (fewer admissible positions) or revisit the sum guard — documented on the constant.
- `yarn lint` red on pre-existing toolchain lints (§4). Not touched here.
- The optional env-gated Playwright "Paused badge" spec from the plan was not added; the badge was verified via `verify-live` reading `isPaused: true` after `yarn pause-market`, and the UI's badge/guard wiring is unchanged from the shipped, e2e-tested build.

## 8. Not started

Component 11. No UI redesign. No unrelated module cleanup.
