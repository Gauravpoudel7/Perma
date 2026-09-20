# Component 11 (Events / Thin Indexing) — Phase 0 Feasibility

**Date**: 2026-09-21 · **Spec**: [`11-events-indexing.md`](../02-mvp-components/11-events-indexing.md) (narrowed this pass) · **Scope authority**: [`MVP-SCOPE.md`](../00-overview/MVP-SCOPE.md) §Out of Scope ("Advanced Indexing … minimal RPC cache is OK"), [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) P0 vs P2 · **Prompt**: [`CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md`](../prompts/CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md)
**Stack**: anchor-lang 1.2.0 / `@coral-xyz/anchor` 0.32.1 (root and `apps/web`, byte-identical) — unchanged.

## Verdict: **GO** — with **zero program changes**

| Gate condition | State |
|---|---|
| Q0 inventory of every `#[event]` / `emit!` on Mac disk, cited | ✅ 19 events, 20 emit sites, all in `lib.rs` (below) |
| Fair-required event gaps | ✅ **none** — component 10 already shipped `MarketPauseSet` / `MarketPauseCleared` / `MarketRiskParamsSet`; every one of the 17 instructions emits on its success path |
| Q1 Fair-vs-P2 cut published | ✅ (below) |
| Q3 consumer choice recorded | ✅ decode-on-confirm in `useSendPermaTx`, poll stays the source of truth |
| Pause event names verified against 10 | ✅ `*PauseSet` / `*PauseCleared`, no collision with `PermaError::MarketPaused`; no-op calls emit nothing (kept) |
| No renames, no field reorders, no IDL regeneration needed | ✅ `target/idl/perma.json` ≡ `apps/web/src/idl/perma.json` (`cmp` clean); 19 events with discriminators + `types` entries |

## Q0 — Live inventory (`programs/perma/src/lib.rs`)

| Event (line) | Emitted by (line) | Fields (in order) | Path | IDL | Tested today |
|---|---|---|---|---|---|
| `GlobalConfigInitialized` (2845) | `initialize_global_config` (51) | admin, allowlisted_whirlpool | product/admin | ✅ | state only |
| `MarketCreated` (2852) | `create_market` (128) | market, whirlpool, tick_spacing: u16, admin, premium_rate: u64, premium_multiplier: u64 | admin | ✅ | state only |
| `MarketPauseSet` (2866) | `pause_market` (158) — **only on transition** | market, admin | admin (10) | ✅ | state only |
| `MarketPauseCleared` (2872) | `unpause_market` (174) — only on transition | market, admin | admin (10) | ✅ | state only |
| `MarketRiskParamsSet` (2878) | `set_market_risk_params` (205) | market, admin, long_margin_horizon_slots: u64, long_margin_buffer_usdc: u64 | admin (10) | ✅ | state only |
| `RangeValidated` (2886) | `validate_short_range` (241) | market, tick_lower: i32, tick_upper: i32, tick_array_lower, tick_array_upper, current_tick: i32 | product (dry run) | ✅ | state only |
| `CollateralDeposited` (2805) | `deposit_collateral` (303) | market, owner, amount_a, amount_b, balance_a, balance_b (u64) | product | ✅ | state only |
| `CollateralWithdrawn` (2815) | `withdraw_collateral` (384) | same shape | product | ✅ | state only |
| `CollateralLocked` (2825) | `lock_collateral` (412) | market, owner, amount_a, amount_b, locked_a, locked_b | product | ✅ | state only |
| `CollateralUnlocked` (2835) | `unlock_collateral` (439) | same shape | product | ✅ | state only |
| `ShortMinted` (2899) | `mint_position` SHORT (642) | market, owner, perma_position, orca_position, tick_lower, tick_upper, liquidity: u128, locked_a, locked_b, open_positions: u16 | product | ✅ | state only |
| `LongMinted` (2914) | `mint_long_inner` (1867) ← `mint_position` LONG | market, owner, perma_position, tick_lower, tick_upper, size: u128, entry_index: u128, total_short_liquidity, total_long_liquidity, available_after (u128) | product | ✅ | state only |
| `PremiumSettled` (2931) | `settle_long_cash` (1301), `settle_short_cash` (1352) — both behind `require!(> 0, NothingToSettle)` | market, owner, perma_position, leg_type: u8, amount: u64, still_owed: u64, premium_pool: u64, premium_owed_usdc: u64 | product | ✅ | state only |
| `LongBurned` (2944) | `burn_long_inner` (1659) ← `burn_position` | market, owner, perma_position, size: u128, premium_paid_usdc: u64, total_long_liquidity, available_after | product | ✅ | state only |
| `ShortBurned` (2956) | `burn_position` SHORT (849) | market, owner, perma_position, liquidity: u128, unlocked_a, unlocked_b, returned_a, returned_b, premium_claimed, premium_receivable (u64), **status: u8**, open_positions: u16 | product | ✅ | state only |
| `PositionOpened` (2977) | `adapter_open_position` (960) | market, perma_position, orca_position, position_mint, tick_lower, tick_upper | harness | ✅ | state only |
| `PositionClosed` (2987) | `adapter_close_position` (1008) | market, perma_position, orca_position | harness | ✅ | state only |
| `LiquidityAdded` (2994) | `adapter_add_liquidity` (1096) | market, perma_position, orca_position, tick_lower, tick_upper, liquidity: u128, amount_a, amount_b | harness | ✅ | state only |
| `LiquidityRemoved` (3006) | `adapter_remove_liquidity` (1176) | market, perma_position, orca_position, liquidity: u128, amount_a, amount_b, closed: bool | harness | ✅ | state only |

No `emit!` exists outside `lib.rs`. `grep -rn "EventParser\|parseLogs\|getTransaction\|logMessages" tests/ apps/web/src` → zero hits: **nothing decodes an event anywhere today**; the only log reads are error-path sniffs (`adapter-liquidity.ts`, `parseAnchorError`). No event carries a slot or timestamp — consumers take those from tx meta.

## Q1 — Fair vs P2 (implemented exactly this)

| In Fair 11 | Out — P2 ([`INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md)) |
|---|---|
| Frozen event catalog: [`EVENT-CATALOG.md`](../03-api-interfaces/EVENT-CATALOG.md) | Postgres / Prisma / Docker DB, `indexer/` service |
| Thin consumer: decode a confirmed tx's events → targeted refetch; poll unchanged | `GET /markets`, `/positions/{owner}/history`, `/premium/series`, `/liquidations`, `/health` |
| `tests/events.ts` decoding every product-path event + pause no-op | Charts, depth, synthetic P&L / history series |
| `apps/web/test/events.test.ts` on fixture logs | Websocket subscriptions, "instant" sub-second UI |
| RPC cross-check before risk-increasing txs — **kept** (`fetchFreshOpenLongs` in `OpenPositionButton` / `WithdrawForm`) | Replacing RPC poll as Portfolio's backend |
| Spec + arch docs narrowed; stale `PositionMinted` list in `PRD.md` fixed | Renaming / removing / reordering any event |

## Q2 — Stability rules (restated, nothing to change)

No renames; no field reorders or removals; additive only (new event preferred over appending fields); pause names already collision-free; no-op pause/unpause emits nothing; `PremiumSettled` is emitted only with a matching token movement (both sites sit behind `NothingToSettle`).

## Q3 — Consumer choice

**Decode-on-confirm in `apps/web/src/hooks/useSendPermaTx.ts`** (the prompt's preferred path). After `confirmTransaction(…, "confirmed")`, `fetchTxEvents` calls `getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })` and parses `meta.logMessages` with Anchor's `EventParser(program.programId, program.coder)`. The events choose which extra slices to refetch (market / premium index / the touched range) on top of today's unconditional collateral + positions refetch. Failure mode is explicit: decoding is best-effort and returns `[]`; the blanket refetch and the 15–30 s polling hooks are untouched, so a slow or missing `getTransaction` changes nothing the user can see except a missing toast detail line. Rejected: a standing `scripts/` listener (nothing in the demo loop needs a process that outlives a tx) and any UI dependency on an indexer URL.

## Q4–Q6 — Surface, IDL, cost

No account or instruction changes; no accounts added anywhere; no IDL regeneration; no CU impact (nothing on-chain changes). `anchor build` is not run for this component; `target/deploy/perma.so` from component 10 is what the gate deploys.

## Q7 — UI scope

Required: Portfolio renders and refreshes via poll whether or not decoding works — true by construction (no hook is removed, no component reads events to render). Risk-increasing actions keep their pre-flight `fetchFreshOpenLongs` RPC cross-check. Optional, included: the success toast shows the decoded event name(s) as a mono detail line (one optional field on `ToastData`).

## Decisions recorded

- `EVENT-CATALOG.md` lives beside `ERROR-CATALOG.md` / `INSTRUCTIONS.md` — the repo's API-surface docs.
- `tests/events.ts` is appended **last** in the release-gate list and self-heals like `pause-admin.ts` (unpause, restore risk defaults, burn everything it opened).
- `OFFCHAIN-ARCHITECTURE.md` / `TECH-STACK.md` §Indexing / `REPO-STRUCTURE.md` `indexer/` are marked **aspirational — P2**, not deleted.
