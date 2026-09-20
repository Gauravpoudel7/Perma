# Component 10 (Pause / Admin) — Phase 0 Feasibility

**Date**: 2026-09-20 · **Spec**: [`10-pause-admin.md`](../02-mvp-components/10-pause-admin.md) · **Forward requirement**: [ADR-0003 §"Forward requirement for component 10"](../adr/ADR-0003-fair-mvp-risk-model.md) · **Prompt**: [`CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md`](../prompts/CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md)
**Stack**: anchor-lang `1.2.0`, `orca_whirlpools_client` 8.0.0 (no `anchor` feature), `--arch v0` — unchanged.

## Verdict: **GO**

| Gate condition | State |
|---|---|
| Q0 inventory of every `is_paused` / `MarketPaused` / wrong-error site, cited | ✅ 10 sites in `lib.rs`, 4 call sites in `apps/web` (below) |
| Q1 pause matrix written, no second "freeze" mode invented | ✅ (below, mirrors the prompt cell-for-cell) |
| Q2 zero account-layout change | ✅ reuse `Market.is_paused` + existing risk fields; `GlobalConfig` untouched; `pause_global` deferred |
| Q3 admin auth mirrors `create_market` | ✅ new `factory::require_admin`, reused by all three admin ixs |
| Q4 `set_market_risk_params` overflow re-validation designed with a documented bound | ✅ (below) |
| No premium math, Orca metas, solvency formula, or `Market` field order touched | ✅ by construction — guard lines only |

---

## Q0 — Live inventory

`programs/perma/src/lib.rs` (line numbers at the start of this pass):

| Line | Handler | Today | Action |
|---|---|---|---|
| 114 | `create_market` | `market.is_paused = false;` | keep (write, not a guard) |
| 188 | `deposit_collateral` | `require!(!…is_paused, MarketPaused)` | **keep** — deposit is risk-increasing (funds new mints) |
| 249 | `withdraw_collateral` | same | **remove** — exit path; still gated by 09 solvency |
| 327 | `lock_collateral` | same | **keep** — risk-increasing |
| 355 | `unlock_collateral` | same | **remove** — exit path; still gated by `PositionsOutstanding` |
| 398 | `mint_position` | same | **keep** — the whole point of pausing |
| 605 | `settle_premium` | same | **remove** — Exit Guaranteed: a paused market must still let longs pay and shorts collect |
| 662 | `burn_position` | same | **remove** — Exit Guaranteed |
| 820 | `adapter_open_position` | `require!(!…is_paused, WhirlpoolNotAllowlisted)` | **fix error code** → `MarketPaused` |
| 962 | `adapter_add_liquidity` | same wrong error | **fix error code** → `MarketPaused` |
| — | `validate_short_range`, `adapter_close_position`, `adapter_remove_liquidity` | no check | keep (dry-run / exit paths) |
| — | `pause_market`, `unpause_market`, `set_market_risk_params` | do not exist | **add writers** |

`apps/web/src`: `hooks/useWalletGuard.ts:35-37` blocks on `market.isPaused` unless `allowWhilePaused`; `CloseSettleAction.tsx:35` `true` (keep), `WithdrawForm.tsx:26` `true` (keep), `DepositForm.tsx:37` `true` (**remove** — chain will now reject), `OpenPositionButton.tsx:31` no opts (keep, blocked). `TopBar.tsx:17-21` badge already truthful. `lib/errors.ts:31` `Unauthorized` copy is settle-specific (broaden). IDL: `is_paused`, `MarketPaused`=6013, `Unauthorized`=6015 present; no pause ixs.

## Q1 — Pause matrix (implemented exactly this)

| Instruction | While `Market.is_paused` |
|---|---|
| `pause_market` / `unpause_market` | Allowed (admin) |
| `set_market_risk_params` | Allowed (admin) |
| `initialize_global_config` / `create_market` | Unchanged (admin; create sets `is_paused = false`) |
| `mint_position` (long + short) | **Reject** `MarketPaused` |
| `burn_position` | **Allow** |
| `settle_premium` | **Allow** |
| `deposit_collateral` | **Reject** |
| `withdraw_collateral` | **Allow** (still 09 solvency) |
| `lock_collateral` | **Reject** |
| `unlock_collateral` | **Allow** (still `PositionsOutstanding` when shorts open) |
| `validate_short_range` | Allow |
| `adapter_open_position` / `adapter_add_liquidity` | **Reject** `MarketPaused` |
| `adapter_close_position` / `adapter_remove_liquidity` | **Allow** |

No disagreement with any cell. The rule that generates it: *pause blocks every path that adds risk or adds funds that could back new risk; every path that reduces or exits risk stays open, subject to its own existing gates.* No "freeze" mode in Fair MVP.

## Q2 — Account layouts

Zero change. `Market.is_paused: bool` (`state.rs:101`) is reused as-is; `long_margin_horizon_slots` / `long_margin_buffer_usdc` are the existing tail fields the setter writes in place. `GlobalConfig { admin, allowlisted_whirlpool, bump }` gains nothing — a global pause flag would resize the singleton and brick the existing PDA without a migration, so `pause_global` is **deferred** (spec `10-pause-admin.md` updated to say so). `state.rs` is not edited. Localnet redeploy leaves existing `Market` bytes intact: `is_paused` stays `false` until an admin pauses; the setter overwrites in place, no realloc.

## Q3 — Admin authorization

New `factory::require_admin(config: &GlobalConfig, admin: &Pubkey) -> Result<()>` = `require_keys_eq!(*admin, config.admin, PermaError::Unauthorized)`. `authorize_create_market` now calls it first, then the allowlist check — identical order and errors as before, so `tests/factory.ts` / `factory-rewards.ts` are unaffected. Accounts for the three admin ixs mirror `CreateMarket` minus the payer: `admin: Signer` (not `mut`), `global_config` (`seeds=[GLOBAL_CONFIG], bump=global_config.bump`), `market` (`mut`, `seeds=[MARKET, market.whirlpool.as_ref()], bump=market.bump` — the `ValidateShortRange` pattern). No allowlist re-check inside pause.

## Q4 — `set_market_risk_params` overflow re-validation (ADR-0003)

Writes only `long_margin_horizon_slots` and `long_margin_buffer_usdc`. Never `premium_rate` / `premium_multiplier`. The margin formula is untouched: `risk::required_margin(market, L)` becomes a one-line delegate to `required_margin_with(horizon, rate, mult, buffer, L)` holding the exact existing body, so both the runtime path and the validator share one checked-math implementation (the three existing `required_margin` unit tests pin the refactor).

**Validator** `risk::validate_risk_params(horizon, buffer, rate, mult)`:
1. `horizon > 0` — a zero horizon collapses margin to the buffer for any L (ADR's projected-premium term vanishes).
2. `buffer > 0` — the ADR's "flat µUSDC floor so a dust-sized long still needs real money".
3. `required_margin_with(horizon, rate, mult, buffer, MARGIN_LIQUIDITY_BOUND)` must be `Ok` — the product chain and the `u64` fit for the largest position we admit.
4. **Sum guard**: `margin(BOUND) × MAX_OPEN_LONGS ≤ u64::MAX` — `required_free_usdc` sums up to 8 margins then `u64::try_from`s; that sum is the ADR's "brick at withdraw" vector, one line to guard.

All four reject with a new `InvalidRiskParams` (appended last, code 6034); `MathOverflow` remains the runtime error inside the shared math. `required_margin_with` is monotone in L, so passing at the bound proves every L ≤ bound is safe under the new params.

**Bound**: `MARGIN_LIQUIDITY_BOUND = 1 << 52 = 4_503_599_627_370_496`. Justification: the demo mints L = 1e3–1e8 (`SHORT_L = 100_000_000`, longs 1_000–50_000_000 in `tests/risk-solvency.ts`), so the bound is ~4.5e7× the largest demo position; on a tick_spacing-8 SOL/USDC pool at ~$200 it is ≈ $800k in the narrowest 8-tick band and ≈ $200M across the demo's 2008-tick range — larger than any single Orca position. The trade-off is the horizon ceiling implied by the sum guard: `8 × (horizon × rate × mult / 1e12) × 2^52 ≤ u64::MAX` ⇒ factor ≤ 512 ⇒ at demo rate/mult **horizon ≤ ~512_000 slots (~2.4 days)**. Raising the bound tightens that ceiling (2^56 → ~3.5 h); lowering it loosens it but admits fewer positions. The constant's doc comment carries this equation so the trade is explicit.

**Defaults pass with headroom** (horizon 1_000, rate 1e6, mult 1e3, buffer 1e6, L = 2^52): `scaled = 1_000 × 1_000_000 × 4_503_599_627_370_496 × 1_000 ≈ 4.50e27` (u128 max 3.4e38); `q = 4_503_599_627_370_496`, `r = 0`; `total = 4_503_599_628_370_496 < u64::MAX` (4096× headroom); `sum = 36_028_797_026_963_968 < u64::MAX` (512× headroom). Unit tests: defaults pass; `horizon = 1_000_000` fails at the sum guard (single margin fits, ×8 does not); `horizon = u64::MAX` fails at the product chain; zeros fail.

## Q5 — IDL / clients

`anchor build --arch v0`, then `cp target/idl/perma.json target/types/perma.ts apps/web/src/idl/` (the documented resync; no hand edits). Client gains `pauseMarket` / `unpauseMarket` / `setMarketRiskParams` builders through the IDL; the admin script uses `program.methods.*` directly.

## Q6 — Tx size / CU

Three accounts (`admin`, `global_config`, `market`) + 0/16 bytes of args — measured once from `tests/pause-admin.ts` and recorded in the report. No accounts added to `mint_position` / `burn_position` / `settle_premium` / `withdraw_collateral`.

## Q7 — UI scope

Required: `DepositForm` drops `allowWhilePaused: true`; Withdraw / Close-Settle keep it; Trade open CTA stays blocked; TopBar badge unchanged. Admin surface = `apps/web/scripts/pause-market.ts` (`yarn pause-market` / `unpause-market` / `set-risk-params`), not an admin page. Optional env-gated Playwright spec proves the "Paused" badge against a really paused market. Forbidden and not done: touching Trade account metas, liquidation UI, the prototype banner.

## Decisions recorded

- **Events**: `MarketPauseSet { market, admin }` / `MarketPauseCleared { market, admin }` (not `MarketPaused` — that name is already the error) and `MarketRiskParamsSet { market, admin, long_margin_horizon_slots, long_margin_buffer_usdc }`.
- **Emit on transition only**: pausing an already-paused market (or unpausing an unpaused one) returns `Ok(())` with no event — idempotent for ops scripts and retry loops; documented in `INSTRUCTIONS.md`.
- **`pause_global`**: deferred (Q2).
- **Test placement**: `tests/pause-admin.ts` appended last in the release-gate list; self-heals (unpause + restore defaults) in `before()` and `after()` so the double/reverse gate runs stay order-independent.
