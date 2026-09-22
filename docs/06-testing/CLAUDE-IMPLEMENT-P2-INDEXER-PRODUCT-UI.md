# PERMA — Claude Code Prompt: P2 Indexer + Product UI

**How to use:** New Claude Code chat in the **P1-shipped** repo root (`Perma/`, prefer Mac `/Users/maxcell/perma/Perma`). Paste `PROMPT` → `END PROMPT`, then the one-liner.

**Why this session exists:**  
Fair MVP **01–11 is COMPLETE**. Protocol V1 **P1 Production Hardening** shipped **locally** (not necessarily pushed): `transfer_admin`, `unwind_empty_range`, `yarn monitor`; release gate **114/114** (was Fair **102/102**). User will push P1 separately — **do not reopen Fair or re-implement P1**.

This session ships **Protocol V1 P2 — Indexer + Product UI** under `docs/09-post-mvp/ROADMAP.md` / `INDEXER-AND-PRODUCT-UI.md`: a **pragmatic, honest** off-chain ingest + public read APIs, and Markets / Trade / Portfolio history surfaces fed by **real indexed data only**. Charts that cannot be backed by indexed series stay **hidden or empty/degraded** — never fabricated.

**Explicitly OUT (blacklist — do not touch):** P3 oracle / ADR-0004 code; P4 liquidation / force-exercise instructions or UI gauges; P5 multi-leg; P6 Raydium / multi-pool factory; Fair reopen (Exit Guaranteed, premium math, Orca metas, ADR-0003 formulas); fake charts / order-book depth / TVL-APY tiles; synthetic mark PnL contradicting ADR-0003; replacing RPC poll as source of truth for risk-increasing balances; enterprise observability stacks (Kafka, ClickHouse, Grafana) unless Phase 0 proves a blocker without them.

**Honesty banner (repeat in feasibility + report):**  
`Prototype. Not audited. Single pool. Not production mainnet risk capital.`

---

````text
PROMPT
=====

# Role

You are a senior full-stack Solana engineer implementing **PERMA Protocol V1 — P2 Indexer + Product UI**.

Fresh chat. Extend the **P1-shipped** program + Fair thin UI. **Do not rewrite** the Orca adapter, premium engine, burn/settle cash path, solvency math (ADR-0003), Exit Guaranteed pause matrix (10), Fair/P1 event names, `transfer_admin`, or `unwind_empty_range`. Keep **114/114** release gate + unit suite green (helpers/additions only — never drop prior coverage).

# Product lock

- Fair MVP closed + P1 local: one allowlisted WSOL/devUSDC Orca Whirlpool, 1-leg, localnet UI live
- Banner: Prototype. Not audited. Single pool. Not production mainnet risk capital.
- Program id (verify in `Anchor.toml` / `declare_id!`): `4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt`
- Stack (on-chain): `anchor-lang` **1.2.0**, `orca_whirlpools_client` **8.0.0** **without** `anchor` feature, **`anchor build --arch v0`**
- Allowlisted pool (do not change): `2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G` (tick_spacing **8**)
- Tip context: Fair tip was `f6a6a22`; P1 is **local** with gate **114/114** — re-verify `git log -1`, EVENT-CATALOG count (expect ~**21** after P1 additive events), and suite counts on **your** checkout
- Suites: **114** integration (RELEASE-GATE §4.2 + P1 cases) + unit (`yarn test:unit`, was 66 at Fair) must stay green; **add** indexer + UI tests

# Authority docs (read in this order before Phase 0)

1. `docs/09-post-mvp/ROADMAP.md` — **P2** entry/exit/forbidden
2. `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md` — **primary** API + chart honesty rules
3. `docs/09-post-mvp/COMPLETE-PRODUCT-DEFINITION.md` — **Indexer** + **UI** checklists only
4. `docs/09-post-mvp/GAP-ANALYSIS-FAIR-TO-COMPLETE.md` — charts/analytics row; ignore stale “10/11 not shipped” cells vs your disk
5. `docs/09-post-mvp/NON-GOALS.md` — no fake TVL/APY/depth; no pixel-Panoptic; no Fair reopen
6. `docs/03-api-interfaces/EVENT-CATALOG.md` — live event surface (Fair 19 + P1 additive; **re-count on disk**)
7. `docs/01-architecture/OFFCHAIN-ARCHITECTURE.md` — **aspirational** topology; Phase 0 may choose a smaller stack
8. `docs/02-mvp-components/11-events-indexing.md` — Fair-thin consumer + **security note** (RPC cross-check before risk-increasing txs)
9. `docs/05-engineering/REPO-STRUCTURE.md` — `indexer/` marked P2 / not in repo
10. Fair UI reality: `apps/web` Trade / Portfolio / Vault; `usePolledAccount`; `lib/events.ts`; `WIREFRAMES.md` (depth descoped); `APP-SHELL.md`; `UI-QA-CHECKLIST.md`; `BRAND-SYSTEM.md`; `COPY-DECK.md`
11. Risk honesty: `docs/adr/ADR-0003-fair-mvp-risk-model.md` — **no mark PnL**; spot display-only
12. Gate: `docs/06-testing/RELEASE-GATE.md` (update surgically for P2 additions; do not reopen Fair)
13. Prior prompt quality bar: `docs/prompts/CLAUDE-IMPLEMENT-P1-PRODUCTION-HARDENING.md`, `CLAUDE-IMPLEMENT-11-EVENTS-INDEXING.md`, `CLAUDE-IMPLEMENT-10-PAUSE-ADMIN.md` (check `docs/06-testing/` copies if prompts gitignored)
14. Live code inventory targets: `programs/perma/src/lib.rs` events; `apps/web/src/lib/events.ts`; hooks; `scripts/monitor-health.mjs` / `reconcile.mjs` (P1); absence of `indexer/`

# Repo facts (re-verify on disk; do not invent)

## Research snapshot (drafting agent, 2026-09-21 NPT) — HINTS ONLY

Mac `machineId` `67a1ed8b-11e7-4872-947f-bdff8253ed02` was **unreachable** from the drafting executor (no ListMachines/CopyToBox in that session). Snapshot below is from box mirror of GitHub `Gauravpoudel7/Perma` **@ f6a6a22** (Fair-closed, **pre-P1**) + human context that **P1 is local** (114/114; `transfer_admin`, `unwind_empty_range`, `yarn monitor`; events may be **21**). **Your Phase 0 inventory on the Mac checkout is authoritative.**

### Already true on Fair tip — DO NOT BREAK

| Fact | Where |
|---|---|
| Fair 01–11 complete; Fair gate was 102/102 + unit 66 | `RELEASE-GATE.md`, `MVP-SCOPE.md` |
| P1 local (human): transfer_admin, unwind_empty_range, monitor; gate **114/114** | Verify on Mac; additive events `AdminTransferred` / `RangeUnwound` expected |
| 19 Fair events catalogued; thin consumer in web | `EVENT-CATALOG.md`, `apps/web/src/lib/events.ts`, `tests/events.ts` |
| UI: Trade / Portfolio / Vault only — **no Markets nav**, **no history**, **no charts** | `Sidenav.tsx`, `PositionsTable.tsx` (“no history view”) |
| Polling source of truth: Market 30s; positions/collateral/range/premium 15s | `useMarket`, `usePositions`, `useUserCollateral`, `useRangeState`, `usePremiumIndex` via `usePolledAccount` |
| Post-tx: decode events → targeted refetch; poll continues | `useSendPermaTx` + `events.ts` |
| RPC cross-check before risk-increasing actions | `OpenPositionButton`, `WithdrawForm` (fresh open longs from RPC, not store) |
| **No** `indexer/` package; REPO-STRUCTURE marks it P2 | repo root |
| OFFCHAIN-ARCHITECTURE aspirational Node/Postgres/Fastify | doc header: Fair ships no off-chain service |
| ADR-0003: no mark/TWAP PnL; long burn PnL = 0; no unrealized mark % | ADR-0003, APP-SHELL |
| WIREFRAMES: cross-range “depth map” descoped — needs indexer | `WIREFRAMES.md` |
| `scripts/reconcile.mjs` (+ P1 monitor) exist — **not** a product indexer | `scripts/` |

### Missing (this phase — P2 ONLY)

1. Standing ingest of finalized program txs → durable store + slot watermark + gap recovery
2. Public read APIs in `INDEXER-AND-PRODUCT-UI.md` (testable)
3. Honest Markets + Portfolio history (+ optional Trade inventory/premium series charts **only** when data exists)
4. Degraded/stale empty states when indexer lagging — **never** placeholder series
5. Liquidation-distance UI **hidden** (schema for `/liquidations` may exist; rows empty until P4)
6. Indexer + UI tests; **114 + unit stay green**
7. Surgical living-doc updates + `IMPL-P2-*` feasibility/report

## Doc conflicts (resolve in Phase 0; do not silently pick the unsafe / vaporware side)

| Conflict | Safer P2 rule (mandated unless Phase 0 proves otherwise) |
|---|---|
| `OFFCHAIN-ARCHITECTURE` Postgres + Fastify + websockets vs startup MVP | **Pragmatic stack OK:** TypeScript preferred (monorepo fit); **SQLite or Postgres**; HTTP API (Hono/Fastify/Express). Websockets **optional**; polling clients OK. Do **not** require Kafka/ClickHouse/Grafana. Document choice in feasibility. |
| INDEXER “inventory by tick range” vs WIREFRAMES “no fake depth” | Inventory chart = **indexed short/long liquidity buckets** from real `RangePremiumState` / mint-burn events — **not** an order book. Label copy honestly (“Inventory by range”), never “Depth”. |
| `/liquidations` required in API table vs P4-only on-chain liq | Ship **schema + empty list** + OpenAPI/comment “empty until P4”. **No** UI liquidation-distance gauge. |
| COMPLETE “Markets list” / factory multi-pool vs Fair 1 allowlisted pool | Markets UI lists **what is on-chain today** (likely one). Do **not** invent multi-pool registration. |
| COMPLETE / APP-SHELL “no P&L column” vs desire for “user PnL history” | History shows **indexed cash facts**: deposits/withdraws, premium paid/claimed (`PremiumSettled.amount`), burns with tx sig. **Forbidden:** unrealized mark %, CEX-style PnL contradicting ADR-0003. Realized short LP (`returned − locked`) only if already on-chain / in events — do not invent. |
| `/premium/series` “monotonic index” vs **no** `PremiumIndexUpdated` event in Fair catalog | Phase 0 **must** pick an honest series source: (A) snapshot `GlobalPremiumIndex` when ingesting any market-touching tx (slot/blockTime from tx meta); (B) optional periodic finalized account poll; (C) omit chart until enough points exist. **Never** interpolate a random walk. Gaps explained via watermark. |
| Component 11 “polling is source of truth” vs product indexer | Indexer is **cache/history**. Keep `usePolledAccount` + post-tx decode. **Mandatory:** RPC verify collateral / open longs before mint/withdraw (existing security note). Indexer must not sign or become sole truth for risk-increasing actions. |
| GAP / 09 README still call 10/11 Fair leftovers | Stale vs disk. Surgically note Fair+P1 done; do not reopen. |
| EVENT-CATALOG stability | Additive consumer support only. Never rename/reorder Fair/P1 events. Wire new P1 events into `slicesTouchedBy` if missing. |
| Aspirational “Position Load < 200ms” targets | Best-effort local; do not fail DoD on marketing latency numbers. |

---

# PHASE 0 — FEASIBILITY (mandatory before code)

Write `docs/audits/IMPL-P2-FEASIBILITY.md` with **GO / GO WITH BLOCKERS / NO-GO**.

## Q0 — Live inventory (cite file:line)

Table on **your** checkout:

1. Every `#[event]` / `emit!` — count vs EVENT-CATALOG (Fair 19 + P1?). Confirm P1 events exist.
2. `apps/web/src/lib/events.ts` — `slicesTouchedBy` coverage vs live names (incl. `adminTransferred` / `rangeUnwound` if present)
3. Every `usePolledAccount` caller + intervals
4. RPC cross-check sites before risk-increasing txs
5. Confirm **absence** of `indexer/` (or describe any stub)
6. P1 artifacts: `transfer_admin`, `unwind_empty_range`, monitor script, gate **114** list
7. Sidenav routes; Portfolio history absence; any chart library already in `apps/web/package.json`
8. Whether any `PremiumIndex*` event exists (expect **no** on Fair)

## Q1 — In-scope vs OUT matrix (implement exactly this)

| Work item | P2 decision |
|---|---|
| Standing ingest at **finalized** commitment + slot watermark + gap recovery | **IN** |
| Durable store (SQLite **or** Postgres) | **IN** — Phase 0 picks one; document why |
| Public GET APIs per INDEXER-AND-PRODUCT-UI.md | **IN** |
| `/liquidations` schema returning `[]` | **IN** (empty until P4) |
| Markets nav + page (pause flags, inventory summary from index/RPC) | **IN** |
| Portfolio **history** (closed positions / settlements with tx sig) | **IN** |
| Premium index **chart** iff real series points exist | **IN** when data; else hidden/empty degraded state |
| Inventory-by-range visualization from indexed buckets | **IN** as inventory — not “depth” |
| Volume/notional tiles | **DEFER** unless trivially sum of indexed mint/burn notionals with defined copy — never APY/TVL marketing |
| Websockets | **OPTIONAL** — HTTP poll OK |
| Keep Fair RPC poll + `events.ts` post-tx path | **IN** (must remain) |
| RPC cross-check before risk-increasing actions | **IN** (must remain) |
| Liquidation distance UI / Risk gauge | **OUT** until P4 |
| Synthetic mark PnL / unrealized % | **OUT** |
| Fake order-book depth / placeholder chart series | **OUT** |
| P3 oracle / Pyth / ADR-0004 | **OUT** |
| P4 force/liq instructions | **OUT** |
| P5 multi-leg UI encoding | **OUT** |
| P6 Raydium / second pool | **OUT** |
| Replacing program event catalog / renaming events | **OUT** |
| On-chain program changes (unless tiny bugfix to keep gate green) | **OUT by default** — P2 is off-chain + UI |

## Q2 — Stack choice (mandated pragmatism)

**Default recommendation (override only with written reason):**

| Layer | Default | Notes |
|---|---|---|
| Language | **TypeScript (Node 24)** | Matches `apps/web` / Anchor TS tests |
| Package path | `indexer/` at repo root (per REPO-STRUCTURE) | Or `apps/indexer` if monorepo yarn workspaces already exist — pick one, don’t scatter |
| DB | **SQLite** for localnet/dev (e.g. `better-sqlite3` / `drizzle` / `prisma`) **or** Postgres if already running | Persist watermark + events + derived projections |
| HTTP | **Hono** or **Fastify** or **Express** — one | Bind localhost; CORS for `apps/web` |
| Ingest | Poll `getSignaturesForAddress(programId)` → `getTransaction(..., commitment: "finalized")` → Anchor `EventParser` | Reuse patterns from `events.ts` / `tests/events.ts`; slot/blockTime from **tx meta** (events have neither) |
| UI data | Thin client `apps/web/src/lib/indexerApi.ts` + hooks | Feature-flag / env `NEXT_PUBLIC_INDEXER_URL`; if unset or unhealthy → existing poll-only UX |

**Forbidden as P2 requirements:** Kubernetes, managed cloud lock-in, paid indexer SaaS as sole path, rewriting the Anchor program to emit a new “chart candle” event stream.

## Q3 — API contract (acceptance tests required)

Implement exactly these (paths may add `/v1` prefix if documented):

| Method | Returns | Acceptance |
|---|---|---|
| `GET /markets` | Allowlisted markets, pause flags, inventory summary | Matches on-chain Market PDAs after sync (within documented lag) |
| `GET /markets/{id}` | Config, premium index snapshot, short inventory by range bucket | Buckets reconcile with position/range aggregates within tolerance **documented in feasibility** (not invented ADR theater) |
| `GET /positions/{owner}` | Open positions, legs, entry indices, last settle | Mint appears ≤ N seconds after finalized (N chosen + tested; e.g. 15–60s local) |
| `GET /positions/{owner}/history` | Closed positions, settlements | Burn/force/liq rows with **tx sig**; force/liq empty until P4 |
| `GET /collateral/{owner}` | Deposits, free/locked, premium owed/earned | UI still RPC-verifies before withdraw |
| `GET /premium/series` | Time series of index / accrued (market-level) | Monotonic index when points exist; **gaps** explained by watermark; empty array if none — **not** synthetic |
| `GET /liquidations` | Historical liq / force | **Always `[]` in P2**; schema stable |
| `GET /health` | Slot watermark, lag, last error | Monitor / UI degraded banner can consume |

Auth: **public reads**; no privileged writes; indexer **never** holds user key material or signs.

## Q4 — UI surfaces (honest)

| Surface | P2 work |
|---|---|
| **Markets** | New sidenav item + page: list market(s), pause badge, link into Trade. Data from indexer with RPC fallback. |
| **Trade** | Keep mint/burn tickets. Optional: premium series chart **or** inventory-by-range from API — only if points/buckets exist; else omit chart region. Do not add fake depth panel. |
| **Portfolio** | Keep open positions table (no mark PnL column). **Add History** section/tab: closed + settlements from `/positions/{owner}/history` with explorer links. Empty state copy when indexer down. |
| **Vault** | Keep deposit/withdraw; retain RPC solvency cross-check. Optional collateral event history if cheap. |
| **Risk / liquidation distance** | **Do not ship** a distance gauge. If a Risk nav item exists in docs, either omit or show only free vs required (already on Vault) without liq distance. |
| **Banner / brand / a11y** | Prototype banner stays. Pass `UI-QA-CHECKLIST` anti-slop + keyboard/focus for new pages. `yarn check-copy` must stay green — no APY/TVL/depth lies. |

**Degraded behavior (binding):** If `/health` lag high or fetch fails → show **stale/degraded** empty states; prefer **hidden chart** over lying chart (`INDEXER-AND-PRODUCT-UI.md` “No fake depth”).

## Q5 — Security (from component 11 — non-negotiable)

1. Indexer is read-only vs chain; never signs.
2. UI **must** RPC-verify critical balances / open-long remaining accounts before risk-increasing actions (mint long, withdraw). Do not replace with indexer reads.
3. Ingest **finalized** only for durable rows; UI may still use confirmed for own txs.
4. Treat indexer as untrusted cache: validate shapes; fail closed to poll-only UX.

## Q6 — Tests & gate

**Indexer (minimum):**
- Unit: event decode → projection fixtures (reuse catalog field orders)
- Integration: localnet mint → wait finalized → `GET /positions/{owner}` shows open; burn → history row with sig
- Gap recovery: artificially advance watermark backward / skip sig → recover without duplicate primary keys
- `/health` reports watermark; `/liquidations` === `[]`
- `/premium/series` never returns fabricated points in tests

**UI:**
- Unit/hooks for indexer client degraded path
- Extend Playwright: Markets nav reachable; Portfolio history empty-state; **no** element claiming liquidation distance; copy check
- `cd apps/web && yarn test && yarn check-copy` (+ e2e you can keep green)

**On-chain gate:**
- Do not break **114/114** both orders on fresh ledger
- `yarn test:unit` stays green
- Do not delete prior tests

## Q7 — Docs / IDL

- Update `EVENT-CATALOG.md` §6 (P2 no longer “deferred” for shipped APIs) — point to `indexer/`
- Update `11-events-indexing.md` Fair-thin vs P2 split honestly
- Update `OFFCHAIN-ARCHITECTURE.md` status: what actually shipped vs still aspirational
- Update `REPO-STRUCTURE.md` indexer checkbox
- Update `RELEASE-GATE.md` with P2 commands (indexer tests + note 114 regression)
- `docs/audits/IMPL-P2-FEASIBILITY.md` + `IMPL-P2-INDEXER-PRODUCT-UI-REPORT.md`
- Do **not** rewrite historical IMPL-0*/P1 bodies (one-line pointer OK)

End Phase 0 with **GO** only when stack + series source + API tolerance + UI honesty rules are written.

---

# PHASE 1 — IMPLEMENT (ordered slices — maximize value, minimize blast radius)

Execute **in order**. Do not start slice N+1 until slice N tests/docs for that slice are done. Stop early only on Phase 0 NO-GO.

## Slice 1 — Indexer skeleton + health

1. Create `indexer/` (or chosen path): package.json, tsconfig, README (how to run localnet)
2. DB migrations: `watermarks`, `raw_events` (or equivalent), minimal projections tables
3. Ingest loop: finalized sigs → decode → persist idempotently
4. `GET /health`
5. Yarn script from root or indexer package: e.g. `yarn indexer:dev`

## Slice 2 — Core read APIs

1. Implement `/markets`, `/markets/{id}`, `/positions/{owner}`, `/positions/{owner}/history`, `/collateral/{owner}`, `/premium/series`, `/liquidations`
2. Acceptance tests against localnet fixture flow
3. Document lag N and reconcile tolerance in feasibility/report

## Slice 3 — Product UI wiring (honest)

1. `indexerApi` client + env
2. Markets page + sidenav
3. Portfolio History section
4. Optional Trade charts **only** with real series/buckets
5. Degraded/empty states; keep poll + RPC cross-check
6. Wire `slicesTouchedBy` for any missing P1 event names (additive consumer only)

## Slice 4 — QA + gate + report

1. UI-QA / a11y / copy
2. Full gate: unit + **114** both orders + web tests + indexer tests
3. `IMPL-P2-INDEXER-PRODUCT-UI-REPORT.md` with residuals (websockets?, Postgres prod, P4 liq UI, series density)

## STOP

Do not start P3/P4/P5/P6. Do not add liquidation distance. Do not invent mark PnL. Do not fabricate chart points. Do not reopen Fair event names or Exit Guaranteed. Do not “clean up” unrelated program modules.

---

# Hard constraints (breakage blacklist)

1. **Do not** emit fake / placeholder / random-walk chart series — ever.
2. **Do not** show liquidation distance or claim liquidations exist.
3. **Do not** show unrealized mark PnL % or contradict ADR-0003.
4. **Do not** label inventory buckets as order-book “depth”.
5. **Do not** invent TVL / APY / user-count marketing tiles.
6. **Do not** remove or stop `usePolledAccount` polling as the safety net.
7. **Do not** remove RPC cross-check before mint-long / withdraw.
8. **Do not** rename/reorder/remove Fair or P1 events; additive consumer support only.
9. **Do not** change premium formulas, Orca CPI metas, ADR-0003 solvency, Exit Guaranteed matrix.
10. **Do not** change program id, allowlisted whirlpool, or tick_spacing.
11. **Do not** embed Squads/oracle/liq program work.
12. **Do not** delete or skip prior tests to go green.
13. **Do not** drive-by format the whole repo.
14. **Do not** require cloud SaaS to pass local DoD.

# Suites that must stay green

Verify script names on disk, then run at least:

```bash
yarn test:unit
# cargo test -p perma --lib  (prior count must remain; P2 should not need Rust changes)

# RELEASE-GATE §4.2 — 114 both orders on a fresh ledger (Fair 102 + P1 cases):
# tests/adapter.ts
# tests/adapter-liquidity.ts
# tests/factory.ts
# tests/factory-rewards.ts
# tests/collateral.ts
# tests/position-short.ts
# tests/position-long.ts
# tests/settle-premium.ts
# tests/risk-solvency.ts
# tests/pause-admin.ts
# tests/events.ts
# + P1 tests (admin-transfer / range-unwind) — confirm filenames on disk
# P2 does not need new on-chain suites unless a tiny bugfix forces one

cd apps/web && yarn test && yarn check-copy
# + yarn test:e2e if still the project norm for UI milestones

# Indexer (names finalize in Phase 0):
# yarn workspace indexer test   OR   cd indexer && yarn test
node scripts/reconcile.mjs
# yarn monitor   # P1 — should still run
```

If validator flakes, restart once and re-run — do not disable assertions.

# Done when

- [ ] `docs/audits/IMPL-P2-FEASIBILITY.md` filed with Q-matrix, stack choice, series source, GO / GO WITH BLOCKERS
- [ ] `indexer/` (or chosen path) ingests **finalized** events; watermark + gap recovery tested
- [ ] All INDEXER-AND-PRODUCT-UI GET APIs implemented with acceptance tests
- [ ] `/liquidations` returns `[]`; no liquidation-distance UI
- [ ] Markets + Portfolio history shipped; charts only from real series; degraded states when lagging
- [ ] Fair poll + `events.ts` + RPC cross-check preserved
- [ ] No fake depth / mark PnL / APY/TVL lies; copy + UI-QA bar held
- [ ] **114 + unit green**; indexer + web tests green
- [ ] Living docs updated surgically; `IMPL-P2-INDEXER-PRODUCT-UI-REPORT.md` written with residuals
- [ ] P3–P6 not started; on-chain surface unchanged absent critical bugfix
- [ ] Honesty banner still true

# Start now

Phase 0 inventory + Q-matrix + stack/series decisions first. Then Slice 1 (ingest+health) → Slice 2 (APIs) → Slice 3 (honest UI) → Slice 4 (gate+report). **Prefer a hidden chart over a lying chart. Prefer RPC truth over indexer convenience for risk-increasing actions.**

END PROMPT
````

## One-liner

```text
Repo is PERMA Fair-closed + P1 local (01–11 + transfer_admin/unwind_empty_range/monitor; gate 114/114). Implement Protocol V1 P2 Indexer + Product UI only: Phase 0 first — inventory events (expect ~21), polls, events.ts, absence of indexer/, confirm P1 on disk; publish Q-matrix + pragmatic stack (TS + SQLite|Postgres + HTTP; no Kafka). Ship finalized ingest with watermark/gap recovery; GET APIs per INDEXER-AND-PRODUCT-UI.md (/liquidations empty until P4); Markets + Portfolio history; charts/inventory ONLY from real indexed data (no fake depth/series/mark PnL). Keep usePolledAccount + events.ts + RPC cross-check before risk-increasing txs. Do NOT touch P3 oracle, P4 liq/force UI or ix, P5 multi-leg, P6 Raydium, Fair event renames, Exit Guaranteed, premium math, Orca metas, ADR-0003. Keep yarn test:unit + 114 release gate + web/indexer tests green. Write IMPL-P2-FEASIBILITY.md + IMPL-P2-INDEXER-PRODUCT-UI-REPORT.md.
```

## Design note for the human

P2’s failure modes are (1) shipping “charts” that are decorative fiction, (2) letting the indexer become the sole balance oracle for mint/withdraw, and (3) sneaking liquidation-distance or mark-PnL UI before P3/P4. This prompt forces Phase 0 stack honesty (SQLite is fine), finalized ingest, empty-liq schema, and degraded UI — while freezing Fair/P1 on-chain gains and the 114 gate.
