# Component: Events Indexing

> **Status: IMPLEMENTED — Fair-thin.** Fair MVP ships (1) the complete on-chain event surface — 19 events, one per lifecycle action, frozen in [`EVENT-CATALOG.md`](../03-api-interfaces/EVENT-CATALOG.md); (2) a **minimal consumer** in the web app that decodes the events of the transaction it just confirmed and refetches only what they touched; (3) tests that decode every product-path event from real transaction logs. The database-backed listener, REST history APIs and websocket push this spec originally described are **P2** — see [`docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md) — per [`MVP-SCOPE.md`](../00-overview/MVP-SCOPE.md) ("Advanced Indexing … out of scope; minimal RPC cache is OK") and [`ROADMAP.md`](../09-post-mvp/ROADMAP.md) P0 vs P2. Record: [`IMPL-11-FEASIBILITY.md`](../audits/IMPL-11-FEASIBILITY.md), [`IMPL-11-EVENTS-INDEXING-REPORT.md`](../audits/IMPL-11-EVENTS-INDEXING-REPORT.md).

## Purpose
Give the off-chain UI an accurate view of protocol state without reading every PDA on every tick, and make the protocol *observable*: every state change is an Anchor event a third party can decode from transaction logs with nothing but the IDL.

## User-Facing Behavior (Fair)
Portfolio, Vault and Trade read chain state by **RPC polling** (`Market` 30 s; positions, collateral, range state, premium index 15 s). After a transaction the user sent confirms, the app refetches collateral + positions unconditionally **and** decodes that transaction's events to refetch the extra slices they name — the touched range, the premium index, the market — so the tiles reflect the new state immediately rather than at the next tick, and the success toast names what happened (e.g. `ShortMinted`). Nothing is "instant" in the websocket sense, and nothing depends on the decode: if it yields nothing, the behavior is exactly the polling one.

## Dependencies
- **Solana RPC**: `getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })` for logs; account reads for polling.
- **Anchor IDL**: event discriminators and layouts (`apps/web/src/idl/perma.json`).

## State & PDAs
No on-chain state. The consumer holds nothing durable: the Zustand `useChainStore` is a per-session cache of the `Market`, `UserCollateral`, `PermaPosition`, `RangePremiumState` and `GlobalPremiumIndex` accounts, refreshed by polling and by post-tx refetch.

## Public Interface (Fair) — `apps/web/src/lib/events.ts`

| Function | Behavior |
|---|---|
| `decodePermaEvents(program, logs) → PermaEvent[]` | Parses PERMA events out of raw log lines with Anchor's `EventParser`; skips other programs and garbage; never throws. |
| `fetchTxEvents(connection, program, signature) → Promise<PermaEvent[]>` | Fetches the confirmed tx and decodes its logs. Returns `[]` on a not-yet-visible tx, missing meta, or any RPC error — **best-effort by contract**. |
| `slicesTouchedBy(events) → { market, collateral, positions, premiumIndex, ranges, allKnownRanges }` | Pure mapping from events to store slices (see the catalog's "Fair consumer use" column). |
| `describeEvents(events) → string` | PascalCase names for the toast detail line. |

Wired in `hooks/useSendPermaTx.ts`: `confirmTransaction` → `fetchTxEvents` → success toast (+ detail) → `Promise.all([refetchAll(), refetchTouched(events)])`.

The REST endpoints (`GET /positions/{owner}`, `/market/{pool}`, `/user/{user}/collateral`, history and series) are **P2** and defined in `INDEXER-AND-PRODUCT-UI.md`.

## Algorithms & Pseudocode (Fair consumer)
```ts
// after confirmTransaction(sig, "confirmed")
const events = await fetchTxEvents(connection, program, sig);   // [] on any failure
update(toast, { detail: describeEvents(events) });
const t = slicesTouchedBy(events);
await Promise.all([
  refetchAll(),                                                  // unchanged: collateral + positions
  t.market       && fetchMarket(...).then(setMarket),
  t.premiumIndex && fetchPremiumIndex(...).then(setPremiumIndex),
  ...(t.allKnownRanges ? knownRanges : t.ranges).map(([lo, hi]) => fetchRangeState(...).then(setRangeState)),
]);
```

## Invariants
- **Polling is the source of truth.** No hook stops polling; no component needs an event to render; a consumer failure is invisible except for a missing toast line.
- **Events are complete and truthful.** Every one of the 19 instructions emits on its success path (17 at component 11, plus P1's `transfer_admin` and `unwind_empty_range`); a failed instruction emits nothing; `PremiumSettled` is emitted only with a matching token movement; idempotent pause/unpause emit nothing.
- **Stability.** No renames, no field reorders/removals, additive only (catalog §5).

## Failure Modes & Errors
- **`getTransaction` returns null** (RPC lagging "confirmed"): decode yields `[]`; the unconditional refetch and polling cover it.
- **RPC error / rate limit**: same — `[]`, poll continues.
- **Re-orgs**: the app reads at "confirmed" and re-polls; there is no durable store to invalidate.

## Security Notes
- **Read-Only**: the consumer has no write access to the blockchain; it is a pure observer.
- **Data Integrity**: The frontend should occasionally "cross-check" critical values (like collateral balance) directly against the RPC before a trade. *(Kept and enforced: `OpenPositionButton` and `WithdrawForm` fetch the user's open longs fresh from RPC — never from the store or from events — before building a risk-increasing transaction.)*

## Test Cases (`tests/events.ts`, 9 cases, in the release gate; `apps/web/test/events.test.ts`, 11 unit cases)
- Mint SHORT → exactly one `ShortMinted`; `locked_b` equals the position's recorded lock; `open_positions` matches the ledger.
- Mint LONG → `LongMinted`; `total_*_liquidity` / `available_after` equal the range state after.
- Settle LONG / settle SHORT → `PremiumSettled` with `leg_type` 1 / 0 and `amount` exactly equal to the escrow delta.
- Burn LONG → `LongBurned`, account gone; burn SHORT → `ShortBurned` whose `status` matches whether the account still exists.
- Pause → `MarketPauseSet`; pause again → **zero** events; unpause → `MarketPauseCleared`; `set_market_risk_params` → `MarketRiskParamsSet`.
- A failed instruction's logs decode to zero events.
- Unit: hand-built `Program data:` fixtures interleaved with Orca/Token/garbage lines decode to exactly the PERMA events; `fetchTxEvents` returns `[]` on null tx / no logs / RPC throw; `slicesTouchedBy` mapping table.

## Observability & Events
The on-chain events are the observability. Full list: [`EVENT-CATALOG.md`](../03-api-interfaces/EVENT-CATALOG.md). There is no separate indexer process in Fair, so `IndexerSyncComplete` / `IndexerError` do not exist; they belong to the P2 service.

## MVP Done Definition (Fair-thin)
- [x] Every lifecycle action emits an event; component-10 admin events included; catalog frozen with stability rules.
- [x] Minimal consumer: decode the confirmed tx's events → targeted refetch; polling and post-tx refetch unchanged; toast names the events.
- [x] Tests decode `ShortMinted` / `LongMinted` / `ShortBurned` / `LongBurned` / `PremiumSettled` (both legs) / pause / risk-param events from real transaction logs.
- [x] RPC cross-check before risk-increasing actions preserved.
- [ ] **P2** — standing listener + database, `GET` history APIs, websocket push, charts from indexed series: `INDEXER-AND-PRODUCT-UI.md`.
