# PERMA indexer (Protocol V1 — P2)

> **Prototype. Not audited. Single pool. Not production mainnet risk capital.**

Read-only off-chain ingest of finalized PERMA events, plus the public read APIs
in [`docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`](../docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md).

**This service is a cache, not an oracle.** The web app still polls the chain on
its own timers (`usePolledAccount`) and still re-reads balances and open longs
over RPC immediately before any risk-increasing transaction. If the indexer is
down, lagging, or lying, the UI degrades to poll-only and nothing unsafe happens.

## What it does

1. Sweeps `getSignaturesForAddress(programId)` at **finalized** commitment.
2. Decodes each transaction's logs with Anchor's `EventParser` and appends them
   to `raw_events`, keyed `(signature, log_index)`.
3. Re-folds every projection from `raw_events` whenever new rows land.
4. Serves the projections over HTTP.

It never signs. The Anchor provider is built on a wallet whose signing methods
reject, so a transaction cannot be produced even by mistake.

## Stack

Zero dependencies. Node 24 stdlib only — `node:sqlite` for storage, `node:http`
for the server, `node:test` for the tests, and Node's own TypeScript type
stripping, so there is no build step. `@coral-xyz/anchor` and `@solana/web3.js`
resolve from the repo root `node_modules`.

`node:sqlite` is still flagged experimental upstream; `--disable-warning=ExperimentalWarning`
silences the notice. The rationale and the upgrade path are in
[`IMPL-P2-FEASIBILITY.md`](../docs/audits/IMPL-P2-FEASIBILITY.md) §Q2.

## Run it

```bash
# from the repo root, with ./scripts/local-validator.sh already up
yarn indexer:dev      # ingest loop + API on http://127.0.0.1:8787/v1
yarn indexer:ingest   # one sweep, print the result, exit
yarn indexer:test     # node --test
```

| Env | Default | Meaning |
|---|---|---|
| `PERMA_RPC_URL` | `ANCHOR_PROVIDER_URL`, else `http://127.0.0.1:8899` | RPC endpoint |
| `PERMA_INDEX_DB` | `indexer/data/perma-index.db` | SQLite file; `:memory:` works |
| `PERMA_INDEXER_PORT` | `8787` | HTTP port, bound to loopback. Startup fails fast with `EADDRINUSE` if something else holds it |
| `PERMA_INGEST_POLL_MS` | `5000` | Sweep interval |
| `PERMA_WHIRLPOOL` | the allowlisted devnet pool | Which market to derive |

Point the web app at it with `NEXT_PUBLIC_INDEXER_URL=http://127.0.0.1:8787/v1`.
Leave that unset and the UI behaves exactly as it did in Fair.

## Routes

`GET /v1/health` · `/v1/markets` · `/v1/markets/{id}` · `/v1/positions/{owner}` ·
`/v1/positions/{owner}/history` · `/v1/collateral/{owner}` · `/v1/premium/series` ·
`/v1/liquidations`

`GET` only; anything else answers `405`. Every response carries the `watermark`
so a client can judge staleness for itself:

```json
{ "slot": 285, "signature": "22LH…QMsA", "lastIngestAt": 1789984687604,
  "lastError": null, "unattributedBurns": 0, "missingGenesis": [], "historyComplete": true }
```

`historyComplete` is the one field a consumer must not ignore. It is false when
the ingested log provably does not reach the beginning of a market's life —
either a burn arrived whose mint was never seen (`unattributedBurns`), or a
market has no `MarketCreated` in the log at all (`missingGenesis`). Both mean an
RPC pruned blocks, and both mean every fold-derived sum is too small. The web app
hides inventory entirely in that state rather than draw a number that is wrong.

`/health` additionally reports `sweptThroughSlot`, and `lagSlots` is measured
against **that**, not against the watermark. The watermark is the last slot PERMA
itself touched; on a quiet chain it falls arbitrarily far behind the head without
the indexer being one slot behind.

`/v1/liquidations` is **always `[]`** in P2. Liquidation and force-exercise are
P4 work; the table and the route shape exist now so nothing has to change later.

## Honesty rules this code enforces

- **No invented data points.** Every entry in `/premium/series` is either a
  decoded `LongMinted.entry_index` (the only historical index value any event
  carries) or a direct `GlobalPremiumIndex` account read, tagged `event` or
  `poll`. Gaps stay gaps. An empty series returns `[]`.
- **Inventory, not depth.** `inventoryByRange` is indexed PERMA short/long
  liquidity per tick range. It is not an order book and must never be labelled
  one.
- **No mark PnL.** History carries cash facts only: deposits, withdrawals,
  premium paid and claimed, burns — each with its transaction signature. No
  unrealized percentage, per [ADR-0003](../docs/adr/ADR-0003-fair-mvp-risk-model.md).

## Recovering from a bad state

The watermark is only a sweep bound, so recovery is safe by construction:

```bash
rm indexer/data/perma-index.db*   # or rewindWatermark(db) in a node one-liner
yarn indexer:ingest
```

Re-seen events collide on `(signature, log_index)` and every projection is
re-folded from the log, so a replay cannot double count.
