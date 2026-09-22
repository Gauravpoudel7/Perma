# IMPL P2 — Indexer + Product UI: implementation report

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

Scope: Protocol V1 P2, as specified in
[`docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md)
and planned in [`IMPL-P2-FEASIBILITY.md`](IMPL-P2-FEASIBILITY.md) (verdict: GO).

Result: **shipped**. A read-only indexer serves eight public GET routes over
projections folded from finalized transactions, and the web app gained a Markets
page, a Portfolio history section, and two charts that render only from real
indexed rows.

Nothing in the Fair or P1 safety model changed. The release gate is still
**114 passing, 0 failing**.

---

## 1. What shipped

### `indexer/` — a zero-dependency service

| File | Responsibility |
|---|---|
| `src/chain.ts` | Config, IDL load, Anchor client, PDA derivations, account reads, JSON-safe conversion |
| `src/db.ts` | `node:sqlite` schema, meta/watermark helpers |
| `src/ingest.ts` | Finalized sweep, log decode, append to `raw_events`, market snapshot, premium poll |
| `src/projections.ts` | One deterministic fold of the whole log into every read model |
| `src/routes.ts` | The eight GET routes |
| `src/server.ts` | `node:http`, loopback bind, `GET`-only, ingest loop supervision |

No new dependencies were added to the repository. `@coral-xyz/anchor` and
`@solana/web3.js` resolve from the root `node_modules`; storage is `node:sqlite`,
HTTP is `node:http`, tests are `node:test`, and Node's TypeScript type stripping
means there is no build step. This is a written override of the prompt's
`better-sqlite3` + Hono default, rationale and upgrade path in
[`IMPL-P2-FEASIBILITY.md`](IMPL-P2-FEASIBILITY.md) §Q2.

### `apps/web/` — additive surfaces

| File | Responsibility |
|---|---|
| `src/lib/indexerApi.ts` | Fetch client. Every function resolves to `null` on unconfigured, unreachable, slow, non-2xx or unrecognised responses |
| `src/hooks/useIndexer.ts` | One-shot query hook with a `degraded` flag |
| `src/app/markets/page.tsx` | Markets page; falls back to live RPC when the indexer is absent, and names its source |
| `src/components/portfolio/HistoryTable.tsx` | Closed positions, settlements and cash movements, each with its transaction signature |
| `src/components/trade/IndexedCharts.tsx` | Inline-SVG premium series and inventory-by-range, no chart library |

`Sidenav.tsx` gained a Markets entry. `lib/events.ts` gained consumer-side
handling for the four previously unhandled event names. `PositionsTable` is
untouched and still has no P&L column.

---

## 2. Design decisions worth recording

### Full re-fold rather than incremental projection updates

`rebuild()` re-derives every projection from `raw_events` whenever new rows land.
The alternative — incremental `UPDATE ... SET x = x + ?` — has to be *proved*
safe against replay, and replay is the normal case here: a rewound watermark, a
re-ingested page, a restarted process. Re-folding makes double counting
structurally impossible instead of conditionally absent, and the test
`replaying the whole log changes nothing (gap recovery is a no-op)` asserts it
byte-for-byte.

The ceiling is O(total events) per batch containing new rows, marked with a
`ponytail:` comment naming the incremental upgrade path. For a single-pool
prototype it is not close to mattering.

### The premium series has exactly two honest sources

No `PremiumIndexUpdated` event exists, and historical account state is not
queryable. So there are exactly two values the chain will actually tell you:

1. `LongMinted.entry_index`, which **is** `GlobalPremiumIndex.current_index` at
   that transaction's slot. Confirmed from the IDL as the only event carrying it.
2. A direct `GlobalPremiumIndex` account read, stamped with the account's own
   `last_update_slot` so the point records when the index moved, not when the
   loop happened to look.

Every stored point is tagged `event` or `poll`. Nothing is interpolated, gaps
stay gaps, and an empty series returns `[]`. The client rejects the entire series
if any point carries an unknown source — a point that cannot be traced is a
fabricated point.

### Reconcile tolerance is exact equality

Bucket sums and `RangePremiumState.total_short_liquidity` are both exact `u128`
sums, so the acceptance test asserts equality with no tolerance band. A fudge
factor here would only ever hide a fold bug.

### Truncated history is reported, not smoothed over

This one came out of a real failure. The reconcile test failed with
`short liquidity drift at [-40176, -38168]: '300000000' != '1100000000'`. The
fold was correct; the RPC had pruned the blocks containing the mints that created
the missing 800000000, so those events were unreachable.

An indexer that silently serves too-small sums in that state is worse than one
that refuses, so the condition is now detected and published. Two independent
signals, because one does not cover the other:

- `unattributedBurns` — a burn arrived whose mint is not in the log.
- `missingGenesis` — a market that has no `MarketCreated` in the log at all,
  which catches the case the burn check cannot see: a mint that was pruned and
  never burned.

`historyComplete` is their conjunction and rides on **every** response, not only
`/health`. `IndexedCharts` hides inventory entirely when it is false.

### Lag is measured against the swept head

`lagSlots` compares the finalized head to `sweptThroughSlot` — the slot the sweep
read before asking for signatures — not to the watermark. The watermark is the
last slot PERMA itself touched, so on a quiet chain it falls arbitrarily far
behind the head while the indexer is perfectly current. Reporting that gap as lag
would call a caught-up service stale; the first live run showed `lagSlots: 682`
for an indexer that was one slot behind.

---

## 3. Verification

All of the following were run on this checkout, against a freshly `--reset`
validator with the program deployed.

| Command | Result |
|---|---|
| `yarn test:unit` | 67 passing |
| RELEASE-GATE §4.2, 12 suites in order, run twice | **114 passing, 0 failing** each pass |
| RELEASE-GATE §4.2, same 12 suites reversed | **114 passing, 0 failing** |
| `yarn indexer:test` | **20 passing, 0 failing** (12 fold fixtures + 8 live-localnet) |
| `node scripts/reconcile.mjs` | `ESCROW IDENTITY HOLDS FOR EVERY RANGE`, 5 ranges, 0 open-long counter mismatches |
| `yarn monitor` | P1 ops surface runs; 0 admin events in the last 50 signatures |
| `apps/web`: `yarn test` | 50 passing (11 new indexer-client cases) |
| `apps/web`: `yarn check-copy` | No banned phrases |
| `apps/web`: `yarn typecheck` | Clean |
| `apps/web`: `yarn test:e2e` | 47 passing, 4 skipped (webkit screenshot set) |

Three gate passes ran against one ledger — twice in the documented order, then
once reversed — so the suites are order-independent and leave no state that
breaks a later run. `reconcile.mjs` reports conservation A and B at `-12` on
that ledger, which is exactly the `-4` per `tests/adapter-liquidity.ts` run the
script's own note predicts for three runs of the harness. The product path never
moves it.

Manual end-to-end against the live service, reading through the real web client
rather than curl, so the response shapes were validated by the code that ships:

```
health:  { lagSlots: 1, historyComplete: true }
markets: 1
buckets: 3
points:  31   sources: [ 'event', 'poll' ]
history: { closed: 42, settlements: 14 }
```

### Ship-blocking checks

| Check | Status |
|---|---|
| `/liquidations` is `[]` | Pass. Asserted in both test files; the client rejects a non-empty array |
| No element claims liquidation distance | Pass. No such component exists |
| `/premium/series` empty rather than interpolated | Pass |
| Inventory never labelled depth | Pass |
| `fetchFreshOpenLongs` still gates mint-long and withdraw | Pass. `OpenPositionButton.tsx:149`, `WithdrawForm.tsx:78`, both untouched |
| `usePolledAccount` polling intact | Pass. No hook changed |
| No fake series anywhere | Pass. Charts render only from returned points and buckets, or not at all |

---

## 4. Residuals

Things a reader should know before trusting or extending this.

1. **`node:sqlite` is an experimental Node API.** The scripts pass
   `--disable-warning=ExperimentalWarning`. If a future Node release changes
   `DatabaseSync`, `src/db.ts` is the single file to adapt; the schema is plain
   SQL and would move to `better-sqlite3` or Postgres without touching the fold.

2. **Single sweep window.** `signaturesSince` walks at most 50 pages of 1000
   signatures. A first sweep against a ledger with more than 50 000 PERMA
   transactions would stop early; the watermark still advances correctly, and the
   next sweep continues, but a full backfill would take several passes.

3. **Full re-fold on every batch with new rows.** O(total events). Fine at
   prototype scale, named in the code as the first thing to change if it ever
   hurts.

4. **Market state is a snapshot, not a fold.** `/markets` reads the Market PDA
   directly, because only an account read can promise to match the PDA. That
   means market config is *fresher* than the rest of the response, and its own
   `snapshotSlot` says so.

5. **Premium poll points depend on the loop having been running.** They are
   account reads and cannot be recomputed, so `rebuild()` deliberately deletes
   only `source = 'event'` points. Deleting the database loses past poll points
   permanently; the event points come back on the next sweep.

6. **Default port 8787 can collide.** Startup fails fast with `EADDRINUSE`
   rather than silently binding elsewhere. Set `PERMA_INDEXER_PORT`.

7. **Charts are minimal by construction.** No axes, no tooltips, no zoom. The
   premium chart draws a connector line between real points, and its caption says
   in so many words that the line is not data.

8. **Block times can be missing.** `getBlockTime` fails for slots outside the
   RPC's history; those points keep `blockTime: null` and the chart falls back to
   slot ordering. A point without a timestamp is still a real point.

9. **No authentication, no rate limiting.** Public reads only, bound to
   loopback. Exposing this service publicly is out of P2 scope and would need
   both.

10. **`/liquidations` and the `liquidations` table are shape-only.** Nothing
    writes them and nothing will until P4 adds the on-chain instruction.

---

## 5. Out of scope, confirmed untouched

P3 oracle / ADR-0004 · P4 liquidation or force-exercise · P5 multi-leg ·
P6 Raydium or a second pool · Fair reopen (Exit Guaranteed, premium math, Orca
CPI metas, ADR-0003 solvency) · program id, allowlisted whirlpool, `tick_spacing`
· Squads CPI · event renames, reorders or removals · fake depth, TVL, APY or
volume tiles · synthetic mark PnL · any change to the RPC poll or the
pre-transaction RPC verification.

No on-chain program file was modified in P2.
