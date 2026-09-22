# Protocol V1 P2 (Indexer + Product UI) — Phase 0 Feasibility

**Date**: 2026-09-21 · **Spec**: [`INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md) · **Roadmap**: [`ROADMAP.md` §P2](../09-post-mvp/ROADMAP.md) · **Non-goals**: [`NON-GOALS.md`](../09-post-mvp/NON-GOALS.md)
**Tip inventoried**: `dd8875e` (P1 production hardening, local) · **Stack on-chain**: unchanged — anchor-lang `1.2.0`, `orca_whirlpools_client` 8.0.0 (no `anchor` feature), `--arch v0`.

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

## Verdict: **GO**

| Gate condition | State |
|---|---|
| Q0 live inventory on this checkout, cited | ✅ 21 events, 14 handled names in `slicesTouchedBy`, no `indexer/` (below) |
| Q1 in-scope / out matrix fixed | ✅ (below, mirrors prompt cell-for-cell) |
| Q2 stack chosen with written reason | ✅ zero-dependency: `node:sqlite` + `node:http` + `node:test` (below) |
| Q3 API contract + reconcile tolerance stated | ✅ eight `GET` routes under `/v1`; tolerance is **exact equality**, not a fudge factor |
| Q4 UI honesty rules bound before any chart code | ✅ hidden-over-lying; no liquidation distance; no mark PnL |
| Q5 security invariants restated and preserved | ✅ read-only indexer, finalized-only durable rows, RPC verify before risk-increasing txs |
| Q6 test plan that does not touch the 114 gate | ✅ additive suites only |
| Zero on-chain change | ✅ P2 is off-chain + UI; no `programs/perma` edits planned |

---

## Q0 — Live inventory (this checkout, not the drafting snapshot)

### Events

21 `#[event]` structs, all in `programs/perma/src/lib.rs` (22 `emit!` sites — `MarketCreated` is emitted from two paths), matching the 21 entries in the IDL at `apps/web/src/idl/perma.json`:

`AdminTransferred`, `CollateralDeposited`, `CollateralLocked`, `CollateralUnlocked`, `CollateralWithdrawn`, `GlobalConfigInitialized`, `LiquidityAdded`, `LiquidityRemoved`, `LongBurned`, `LongMinted`, `MarketCreated`, `MarketPauseCleared`, `MarketPauseSet`, `MarketRiskParamsSet`, `PositionClosed`, `PositionOpened`, `PremiumSettled`, `RangeUnwound`, `RangeValidated`, `ShortBurned`, `ShortMinted`.

Fair's 19 plus P1's two (`AdminTransferred`, `RangeUnwound`, appended at `lib.rs:3255` / `lib.rs:3265` under the "never reorder above" comment). `EVENT-CATALOG.md` is accurate. **No `PremiumIndex*` event exists** — this is the constraint that decides the premium series source (Q3).

### Web consumer

`apps/web/src/lib/events.ts` `slicesTouchedBy` switches on 14 names. Missing from the switch: `adminTransferred`, `rangeUnwound`, `globalConfigInitialized`, `rangeValidated`. The first two are P1 product events and get additive consumer support in Slice 3. `globalConfigInitialized` and `rangeValidated` touch no polled slice (one-time bootstrap; a dry-run validation that writes nothing) and stay unhandled on purpose — the `default:` branch already means "touch nothing".

### Polling (source of truth — unchanged by P2)

| Hook | Interval |
|---|---|
| `useMarket` | 30s |
| `usePositions`, `useUserCollateral`, `useRangeState`, `usePremiumIndex` | 15s |
| `useSpotPrice` | 10s |

All via `usePolledAccount`. Post-tx, `useSendPermaTx` decodes the events it just sent and refetches the touched slices ahead of the next tick.

### RPC cross-check before risk-increasing actions

`fetchFreshOpenLongs` (exported from `hooks/useSendPermaTx.ts`) is called at `components/trade/OpenPositionButton.tsx:149` immediately before building the long-mint instruction. `hooks/useOpenLongs.ts` is documented display-only and must never build `remainingAccounts`; `components/vault/WithdrawForm.tsx` consumes it for display and the same fresh path for the write. **P2 does not weaken either.**

### Absent / present

- No `indexer/` and no `apps/indexer`. `docs/05-engineering/REPO-STRUCTURE.md:17` reserves `indexer/` for P2.
- No chart library in `apps/web/package.json`.
- `components/shell/Sidenav.tsx` `ITEMS` = Trade / Portfolio / Vault. No Markets, no Risk.
- `components/portfolio/PositionsTable.tsx:12` states there is no history view.
- P1 artifacts present: `tests/admin-transfer.ts`, `tests/range-unwind.ts`, `scripts/reconcile.mjs --monitor` behind `yarn monitor`.
- `RELEASE-GATE.md` §4.2 expects **114 passing** over 12 suites (`tests/factory-rewards.ts` excluded on purpose — it allowlists a different pool).

### Toolchain

Node `v24.11.1`, yarn `1.22.22` (classic, **no workspaces block** in the root `package.json`).

---

## Q1 — In-scope vs out

| Work item | P2 |
|---|---|
| Standing ingest at finalized commitment + slot watermark + gap recovery | **IN** |
| Durable store | **IN** — `node:sqlite` (Q2) |
| Public `GET` APIs per `INDEXER-AND-PRODUCT-UI.md` | **IN** |
| `/liquidations` schema returning `[]` | **IN** (empty until P4) |
| Markets nav + page | **IN** |
| Portfolio history (closed positions + settlements with tx sig) | **IN** |
| Premium index chart, only when real points exist | **IN** (hidden otherwise) |
| Inventory-by-range from indexed buckets, labelled as inventory | **IN** |
| Volume / notional tiles | **DEFER** — `COPY-DECK.md:61` bans volume figures without definitions |
| Websockets | **OUT** — HTTP poll is enough for a localnet prototype |
| Fair RPC poll + `events.ts` post-tx path | **IN — must remain** |
| RPC cross-check before mint-long / withdraw | **IN — must remain** |
| Liquidation distance UI / risk gauge | **OUT** until P4 |
| Synthetic mark PnL / unrealized % | **OUT** — contradicts ADR-0003 |
| Fake order-book depth / placeholder series | **OUT** |
| P3 oracle, P4 liquidation, P5 multi-leg, P6 Raydium | **OUT** |
| Renaming / reordering / removing events | **OUT** — additive consumer support only |
| On-chain program changes | **OUT by default** |

---

## Q2 — Stack (written override of the prompt's default)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, Node 24 | Matches `apps/web` and the Anchor TS tests |
| Path | `indexer/` at repo root | Already reserved by `REPO-STRUCTURE.md:17`; root has no yarn workspaces, so a nested workspace package would be the more invasive option |
| DB | **`node:sqlite`** (`DatabaseSync`) | Verified working on this machine. Zero new dependencies, **no native build step**, no second `node_modules` tree |
| HTTP | **`node:http`** | Eight `GET` routes with no middleware needs. A framework would be a dependency bought for ~40 lines of routing |
| Tests | **`node:test`** + `node:assert` | Zero deps, `node --test`, same assert style as the rest of the repo's TS tests |
| Decode | `@coral-xyz/anchor` `EventParser` | Resolves from the root `node_modules` (verified from `indexer/`). Identical decoder to `apps/web/src/lib/events.ts` and `scripts/reconcile.mjs` |
| UI client | `apps/web/src/lib/indexerApi.ts` + `NEXT_PUBLIC_INDEXER_URL` | Unset or unhealthy → existing poll-only UX, unchanged |

**Override justification.** The prompt's Q2 default was `better-sqlite3` + Hono/Fastify. Node 24 ships SQLite and an HTTP server in the standard library, so the pragmatic-stack requirement is satisfied with **zero** new packages, which is strictly lazier than the default and removes a native-compilation failure mode from the local DoD.

**Known caveat (accepted).** `node:sqlite` prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time` and its API may shift across Node majors. Acceptable for a prototype whose DB is a rebuildable cache: every projection is derivable from `raw_events`, and `raw_events` is re-derivable from the chain. Upgrade path if it bites: swap `db.ts` for `better-sqlite3`, whose `prepare`/`run`/`all` surface is near-identical.

**Explicitly not required:** Kafka, ClickHouse, Grafana, Kubernetes, Postgres, or any paid indexer SaaS. `docs/01-architecture/OFFCHAIN-ARCHITECTURE.md` stays aspirational and will be annotated to say so.

---

## Q3 — API contract

Served under `/v1` (documented prefix). Auth: **public reads only**. The indexer holds no key material and never signs.

| Route | Returns | Acceptance |
|---|---|---|
| `GET /v1/markets` | Allowlisted markets, pause flags, inventory summary | Matches on-chain `Market` PDAs at or below the watermark |
| `GET /v1/markets/{id}` | Config, premium index snapshot, short/long inventory by range bucket | Buckets equal on-chain `RangePremiumState` totals — see tolerance below |
| `GET /v1/positions/{owner}` | Open positions, leg type, entry index, last settle | A finalized mint appears within the documented lag (target ≤ 30s local; ingest poll is 5s + finalization) |
| `GET /v1/positions/{owner}/history` | Closed positions + settlements | Every row carries its tx signature; force/liq rows empty until P4 |
| `GET /v1/collateral/{owner}` | Deposits, free/locked, premium owed/earned | UI still RPC-verifies before withdraw |
| `GET /v1/premium/series` | Market-level index points | Monotonic where points exist; `[]` when none; gaps explained by the watermark in the payload |
| `GET /v1/liquidations` | Historical liquidations / force exercises | **Always `[]` in P2.** Schema stable |
| `GET /v1/health` | Watermark slot, finalized slot, lag, last error, last ingest time | Consumed by the UI's degraded banner |

### Reconcile tolerance: exact equality

Not a tolerance band. Bucket sums are exact `u128` deltas of `ShortMinted.liquidity` / `LongMinted.size` minus `ShortBurned.liquidity` / `LongBurned.size`, so for any transaction at or below the watermark they **must equal** on-chain `RangePremiumState.total_short_liquidity` / `total_long_liquidity`. Any drift is an ingest bug, not measurement noise. Inventing an ADR-flavoured tolerance figure here would be exactly the theatre `NON-GOALS.md` warns about.

### Premium series source (honesty-critical)

No `PremiumIndexUpdated` event exists (Q0), and historical account state is not queryable over RPC. Two **real** sources, tagged per point:

1. **`event` points — historical, exact.** `LongMinted.entry_index` *is* `GlobalPremiumIndex.current_index` at that transaction's slot. Confirmed from the IDL: `LongMinted` is the only event carrying `entry_index`. Slot and `blockTime` come from tx meta; events carry neither.
2. **`poll` points — head, exact.** When the ingest loop catches the finalized head, it reads the `GlobalPremiumIndex` PDA and appends `(slot, blockTime, current_index)`.

Rejected: interpolation, random walk, back-fill by formula, or any point not traceable to a decoded event or an actual account read. Where the series is sparse the chart is sparse; where it is empty the chart does not render.

### Range resolution for burns

`ShortBurned`, `LongBurned` and `PremiumSettled` carry **no ticks** (confirmed from the IDL). Burns resolve their range by joining `perma_position` against the `positions` projection written at mint. A burn whose mint predates the watermark is therefore un-attributable — the ingest starts from genesis on a fresh localnet ledger, so this is a documented limitation only for a truncated DB, and rebuilding from `raw_events` fixes it.

---

## Q4 — UI surfaces

| Surface | P2 work |
|---|---|
| **Markets** | New sidenav item + `/markets` page: market list, pause badge, link into Trade. Indexer data, `useMarket` RPC fallback |
| **Trade** | Mint/burn tickets untouched. Optional premium-series and inventory-by-range charts, rendered **only** when the API returns points/buckets. No depth panel, ever |
| **Portfolio** | Open positions table untouched (no P&L column). New History section from `/positions/{owner}/history` with explorer links and an empty state when the indexer is down |
| **Vault** | Untouched. RPC solvency cross-check retained |
| **Risk / liquidation distance** | **Not shipped.** No nav item, no gauge, no distance figure anywhere |
| **Banner / brand / a11y** | Prototype banner stays. `UI-QA-CHECKLIST` anti-slop plus keyboard/focus for the new page. `yarn check-copy` stays green |

**Degraded behaviour (binding).** `/health` lag high or fetch failing → stale/degraded empty states. A hidden chart always beats a lying chart. Copy says "Inventory by range", never "Depth".

---

## Q5 — Security

1. The indexer is read-only against the chain and never signs. It holds no key material.
2. The UI **must** RPC-verify critical balances and open-long remaining accounts before risk-increasing actions (`fetchFreshOpenLongs`). Indexer reads never substitute.
3. Durable rows come from **finalized** transactions only. The UI may still use `confirmed` for a transaction it just sent — that is the existing `events.ts` path and it stays.
4. The indexer is an untrusted cache: responses are shape-validated client-side and any failure falls closed to poll-only UX.

---

## Q6 — Tests and gate

**Indexer** (`node --test`): event decode → projection fixtures; localnet mint → finalized → `GET /v1/positions/{owner}` open, then burn → history row with sig; gap recovery by rewinding the watermark and asserting projections are unchanged after replay; `/v1/health` reports the watermark; `/v1/liquidations` is `[]`; `/v1/premium/series` returns no point that lacks a source.

**Web**: `apps/web/test/indexerApi.test.ts` for the degraded and shape-invalid paths; Playwright extended for Markets nav reachability, Portfolio history empty state, and the absence of any liquidation-distance element; `yarn check-copy` green.

**On-chain**: `yarn test:unit` and the 114-case gate stay green in both orders on a fresh ledger. No prior test is deleted or skipped. P2 adds no on-chain suite.

---

## Q7 — Docs to update (surgically)

`EVENT-CATALOG.md` §6, `docs/02-mvp-components/11-events-indexing.md` (Fair-thin vs P2 split), `docs/01-architecture/OFFCHAIN-ARCHITECTURE.md` (shipped vs aspirational), `docs/05-engineering/REPO-STRUCTURE.md:17`, `docs/06-testing/RELEASE-GATE.md` (P2 commands appended; the 114 list is not touched), plus `IMPL-P2-INDEXER-PRODUCT-UI-REPORT.md`. Historical `IMPL-0*` / P1 bodies are not rewritten.

---

**Related:** [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) · [`INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md) · [`ADR-0003`](../adr/ADR-0003-fair-mvp-risk-model.md) · [`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md)
