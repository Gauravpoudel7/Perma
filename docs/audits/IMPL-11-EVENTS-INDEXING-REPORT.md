# IMPL-11-EVENTS-INDEXING-REPORT

**Status**: Shipped (Fair-thin). **Date**: 2026-09-21. **Spec**: [`11-events-indexing.md`](../02-mvp-components/11-events-indexing.md) (narrowed this pass) · **Feasibility**: [`IMPL-11-FEASIBILITY.md`](IMPL-11-FEASIBILITY.md) (GO, zero program changes) · **Catalog**: [`EVENT-CATALOG.md`](../03-api-interfaces/EVENT-CATALOG.md) · **Prompt**: [`CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md`](../prompts/CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md)

## 1. Shipped surface

| Piece | Where |
|---|---|
| **Event catalog** — the 19 live events with fields in order, emitting instruction, product/harness/admin classification, per-event consumer use, decoding notes, five binding stability rules, explicit P2 deferral | `docs/03-api-interfaces/EVENT-CATALOG.md` (sibling of `ERROR-CATALOG.md` / `INSTRUCTIONS.md`) |
| **Thin consumer** — `decodePermaEvents` (Anchor `EventParser`, never throws), `fetchTxEvents` (`getTransaction` at `confirmed`, `[]` on null/no-logs/error), `slicesTouchedBy` (pure event → slice map), `describeEvents` | `apps/web/src/lib/events.ts` |
| **Wiring** — after `confirmTransaction`: decode → success toast gains a `detail` line naming the events → `Promise.all([refetchAll(), refetchTouched(events)])`, where `refetchAll` is the pre-existing unconditional collateral + positions refetch and `refetchTouched` adds market / premium index / touched range(s) (all-known-ranges when the event names no ticks) | `apps/web/src/hooks/useSendPermaTx.ts`; one optional `detail?: string` on `ToastData` (`primitives/Toast.tsx`) |
| **Decode tests, on-chain** — 9 cases | `tests/events.ts` (appended last in the release-gate list; self-healing like `pause-admin.ts`) |
| **Decode tests, unit** — 11 cases on hand-built `Program data:` fixtures | `apps/web/test/events.test.ts` |
| **Docs narrowed** | `11-events-indexing.md` (status banner, TS API instead of `GET /…`, Fair-thin Done Definition, P2 deferral, cross-check note kept verbatim); `OFFCHAIN-ARCHITECTURE.md` / `TECH-STACK.md` / `REPO-STRUCTURE.md` marked aspirational-P2; `PRD.md` §B32 event list corrected to live names; `MVP-SCOPE.md`, `COMPONENT-INDEX.md`, `INSTRUCTIONS.md`, `docs/README.md`, `RELEASE-GATE.md` (102), `CHANGELOG.md` 0.11.0, `apps/web/README.md` |

**Program, IDL, accounts: untouched.** `programs/`, `target/`, and `apps/web/src/idl/` have no diff. No event was renamed, reshaped or added — the inventory found nothing missing.

## 2. Q0 — what the inventory found

19 `#[event]` structs, 20 `emit!` sites, all in `lib.rs`; every one of the 17 instructions emits on its success path (`PremiumSettled` twice — one per leg — each behind `require!(> 0, NothingToSettle)`; `pause_market` / `unpause_market` skip the emit on their idempotent no-op path, by component-10 design). Component 10 had already shipped `MarketPauseSet` / `MarketPauseCleared` / `MarketRiskParamsSet` with collision-free names. The IDL in `apps/web` was byte-identical to `target/idl`. Zero tests and zero app code decoded an event before this pass — the observability existed on-chain and was unused off-chain. Full table with line numbers: `IMPL-11-FEASIBILITY.md` §Q0.

## 3. Q1 — the cut, as implemented

**In**: catalog, thin consumer, decode tests, doc narrowing, RPC cross-check kept. **Out (P2, `INDEXER-AND-PRODUCT-UI.md`)**: Postgres/Prisma/Docker, an `indexer/` service, `GET /markets` / `/positions/{owner}/history` / `/premium/series` / `/liquidations` / `/health`, charts/depth/series, websockets, replacing polling. The spec's Done Definition was rewritten to say exactly this rather than pretending the DB indexer is Fair work.

## 4. Q3 — why decode-on-confirm

The demo loop's only freshness gap was *"I just did X; why does the tile still show the old number until the next 15 s tick?"* Decoding the transaction the user just sent closes that gap with no new process, no new dependency, and no new trust: the events are read from the same RPC the app already polls, and the unconditional refetch + polling remain unchanged, so a slow or lagging `getTransaction` costs only the toast's detail line. A standing `scripts/` listener would have added a process nothing in the demo needs; any indexer URL would have added a way for Portfolio to go blank. Both rejected.

## 5. What the tests proved (all first-run green)

`tests/events.ts`, decoding real localnet logs with `EventParser` after `getTransaction(…, confirmed)`:
- `ShortMinted`: exactly one per mint; `locked_b` equals the position's recorded lock; `open_positions` equals the ledger's.
- `LongMinted`: `total_short/long_liquidity` and `available_after` equal the range state read back after the tx.
- `PremiumSettled` leg 1 and leg 0: `amount` **equals the range-escrow delta** in both directions — the event is exactly the cash that moved.
- `LongBurned`: account gone. `ShortBurned`: `status` 1 ⇔ account gone, 2 ⇔ account kept with `premium_receivable`.
- `MarketPauseSet` → second `pause_market` yields **zero** events → `MarketPauseCleared`; `MarketRiskParamsSet` carries the written values.
- A failed instruction (`deposit_collateral` while paused) leaves logs that decode to zero events.

`apps/web/test/events.test.ts`: hand-built payloads (discriminator ‖ `program.coder.types.encode`) interleaved with Orca/Token/garbage lines decode to exactly the PERMA events with typed `PublicKey`/`BN` fields; garbage never throws; `fetchTxEvents` → `[]` on null tx / no logs / RPC throw; the `slicesTouchedBy` table; PascalCase toast names.

## 6. Verification

| Gate | Result |
|---|---|
| `cd apps/web && yarn typecheck` | clean |
| `yarn test` (vitest) | **39 passing** (28 + 11) |
| `yarn check-copy` · `yarn build` · `yarn test:e2e` | green · clean · 38 passed / 4 intentionally skipped |
| `yarn test:unit` (root, Rust) | **66** — unchanged, nothing on-chain changed |
| Release gate §4.2, 10 suites, fresh ledger, forward | **102 passing, 0 failing** |
| Same list reversed, same ledger | **102 passing, 0 failing** |

One earlier forward attempt hit a transient `Blockhash not found` in `events.ts`'s `before()` (the other 93 passed) — the classic processed-vs-confirmed blockhash race on a busy test validator. Fixed at the source rather than retried blindly: the suite's `.rpc()` calls now pin `preflightCommitment` and `commitment` to `confirmed` together, so the blockhash is fetched and simulated at one commitment. The fresh-ledger forward + reversed runs above are the post-fix runs.
| `git status`: `programs/`, `target/`, `apps/web/src/idl/` | no changes |

## 7. Residuals (explicit)

- **P2 indexer** — standing listener, database, history APIs, charts: `INDEXER-AND-PRODUCT-UI.md`. Entry condition ("P0 events exist") is now met.
- **No slot/timestamp in event payloads** — consumers take them from tx meta. Adding them would be an additive new-event change; not needed by Fair.
- **Websockets** — none. The app is poll + post-tx decode by design.
- **Toast detail is informational only**; no component renders from events.
- The older suites (`settle-premium.ts` etc.) still assert account state only; `tests/events.ts` is where log-level assertions live. A `settleShort` helper exists only there.

## 8. Not started

P2 indexer / product UI; charts; Fair release-gate doc sweeps beyond component 11.
