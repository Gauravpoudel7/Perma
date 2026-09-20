# CHANGELOG

All notable changes to this project will be documented in this file. Format follows [`08-living-docs/CHANGELOG-POLICY.md`](08-living-docs/CHANGELOG-POLICY.md).

## [0.11.0] - 2026-09-21 — component 11: Events / thin indexing (Fair)
### Added
- `docs/03-api-interfaces/EVENT-CATALOG.md` — the 19 live events, fields, emitting instructions, decoding notes, stability rules; `apps/web/src/lib/events.ts` (`decodePermaEvents`, `fetchTxEvents`, `slicesTouchedBy`, `describeEvents`) wired into `useSendPermaTx` (event-directed refetch of market / premium index / touched ranges on top of the unchanged collateral + positions refetch; toast `detail` names the events); `tests/events.ts` (9, decodes every product-path + admin event from real logs); `apps/web/test/events.test.ts` (11).
### Changed
- `11-events-indexing.md` narrowed to Fair-thin (DB listener / REST history / websockets → P2, `INDEXER-AND-PRODUCT-UI.md`); `OFFCHAIN-ARCHITECTURE.md`, `TECH-STACK.md`, `REPO-STRUCTURE.md` marked aspirational/P2; `PRD.md` §B32 event list corrected to live names. Release gate: 102 passing (was 93).
### Unchanged
- No program, IDL, or account change. No event renamed or reshaped.

## [0.10.0] - 2026-09-21 — component 10: Pause / Admin
### Added
- `pause_market` / `unpause_market` (admin-only, idempotent, emit `MarketPauseSet` / `MarketPauseCleared` on transition); `set_market_risk_params` (admin-only, writes the two ADR-0003 risk fields, re-validates overflow via `risk::validate_risk_params` at `MARGIN_LIQUIDITY_BOUND = 2^52` × `MAX_OPEN_LONGS`, emits `MarketRiskParamsSet`); `factory::require_admin`; `risk::required_margin_with` (shared math, `required_margin` delegates); error `InvalidRiskParams` (6034, appended); `tests/pause-admin.ts` (17); `apps/web` `yarn pause-market` / `unpause-market` / `set-risk-params`.
### Changed
- **Exit Guaranteed**: pause guards removed from `burn_position`, `settle_premium`, `withdraw_collateral`, `unlock_collateral`; kept on `mint_position`, `deposit_collateral`, `lock_collateral`. Adapter `open`/`add` pause checks now return `MarketPaused` (were `WhirlpoolNotAllowlisted`). UI `DepositForm` no longer allows-while-paused. Release gate: 93 passing (was 76), `yarn test:unit` 66 (was 60).
### Deferred
- `pause_global` (would resize `GlobalConfig`); multisig admin.

## [0.9.0] - 2026-09-20 — component 09: Risk & Solvency
### Added
- `Market.long_margin_horizon_slots` / `long_margin_buffer_usdc` (`risk_defaults`), `UserCollateral.open_longs`; `risk.rs` rewritten (`required_margin`, `required_free_usdc`, `check_withdraw_allowed`, `check_long_mint_allowed`, `collect_open_longs`, `MAX_OPEN_LONGS = 8`); `premium::projected_index` / `payable_if_settled_now` (pure); errors `InsolventMint`, `MissingOpenLong`, `TooManyOpenLongs` (appended); `tests/risk-solvency.ts` (10).
### Changed
- `withdraw_collateral` and `mint_position(LONG)` take the owner's open longs as remaining accounts and `premium_index`; the `balance_b > 0` long-mint stub is deleted. `MintPosition`'s Orca-side accounts are `Option` (null for a long) — long mint 612 B, short mint unchanged at 1156 B. `scripts/reconcile.mjs` checks `open_longs` counters.
### Changed (docs)
- Full docs-tree sync against the live program: [`audits/DOCS-SYNC-AUDIT-09.md`](audits/DOCS-SYNC-AUDIT-09.md) — 11 P0 / 124 P1 / 82 P2; every P0 fixed.
- `09-risk-solvency.md` rewritten as an implementation-ready Fair MVP spec; [ADR-0003](adr/ADR-0003-fair-mvp-risk-model.md) accepted (no price input, premium-horizon margin, remaining-account long set).
- `08-burn-settle.md` §E: removed the long intrinsic-value credit (printed USDC) and the second short P&L apply (double-count).
- `INSTRUCTIONS.md`, `ERROR-CATALOG.md` rewritten to the live 14-instruction surface / `PermaError` enum with on-chain codes.
- Global rename `mint_options` / `burn_options` → `mint_position` / `burn_position` across living specs; TWAP / observation / pause claims corrected to Orca and program reality.

## [0.8.0] - 2026-09-20 — component 08: Burn & Settle (premium cash)
### Added
- `settle_premium` (long: permissionless crank; short: owner-only); per-range `range_vault` escrow PDA created by the first short; `PendingPremium` status and `premium_receivable`; `PremiumSettled` event.
- `tests/settle-premium.ts` (10); `scripts/reconcile.mjs` (both money identities over RPC); `scripts/local-validator.sh`.
### Changed
- Long burn pays accrued premium in cash before closing (`InsufficientCollateralForLoss` keeps it `Open`); short burn claims premium before leaving the denominator. `close_long` no longer writes `premium_owed_usdc`.
- Report: [`audits/IMPL-08-BURN-SETTLE-REPORT.md`](audits/IMPL-08-BURN-SETTLE-REPORT.md).

## [0.6.0] - 2026-09-19 — component 06: Long Mint + premium scaffold
### Added
- `GlobalPremiumIndex`, `RangePremiumState`, `update_index` / `poke_range` / `accrue_long` / `payable_from`; inventory-gated `mint_position(LONG)`; V1–V6 vectors as `premium.rs` unit tests; `tests/position-long.ts` (9).
- Report: [`audits/IMPL-06-LONG-MINT-REPORT.md`](audits/IMPL-06-LONG-MINT-REPORT.md).

## [0.5.0] - 2026-09-19 — components 04+05: Position Engine + Short Mint
### Added
- `PermaPosition` PDA; `mint_position(SHORT)` locks the observed spend and adds real Orca liquidity atomically; `burn_position` 3-step close credits Orca returns; `tests/position-short.ts` (7).
- Report: [`audits/IMPL-04-05-POSITION-SHORT-REPORT.md`](audits/IMPL-04-05-POSITION-SHORT-REPORT.md).

## [0.3.0] - 2026-09-19 — component 03: Collateral Manager
### Added
- `UserCollateral`; `deposit` / `withdraw` / `lock` / `unlock`; `risk::check_withdraw_allowed` stub seam; hand-crafted devUSDC fixtures (`scripts/make-fixtures.mjs`); `tests/collateral.ts` (11).

## [0.2.0] - 2026-09-19 — component 02: Factory
### Added
- `GlobalConfig` (single immutable allowlist), `create_market` with live-geometry and active-rewards guards, premium defaults; `tests/factory.ts` (9), `tests/factory-rewards.ts` (2).

## [0.1.1] - 2026-09-19 — components 01 / 01B: Orca CLMM Adapter
### Added
- Hand-built Orca CPI surface (`open_position`, `increase/decrease_liquidity_v2`, `collect_fees_v2`, `close_position`), tick/PDA math with `div_euclid`, the `0x1775` / `0x177c` close-sequence regression guards; `tests/adapter.ts` (12), `tests/adapter-liquidity.ts` (8).
### Changed
- **Toolchain re-pinned** — `anchor-lang` 1.2.0, `orca_whirlpools_client` 8.0.0 without its `anchor` feature, Rust 1.98.1, Solana/Agave 3.0.0, and **`anchor build --arch v0`** is mandatory ([ADR-0001](adr/ADR-0001-orca-cpi-instruction-surface.md) addendum).

## [0.1.0-alpha] - 2026-09-19
### Added
- Initial project structure and `PRD.md`.
- Complete business-class documentation suite under `docs/`.
- Implementation specs for 11 MVP components.
- Institutional UI/UX brand system and design specs.
- Release Gate and Test Strategy.
- Devnet Runbook and Presentation Brief.
- Root `README.md`, `CONTRIBUTING.md`, and PR template.
