---
name: perma-honesty
description: Use this when adding charts, metrics, or marketing-adjacent copy in PERMA apps/web. Prevents fabricated DeFi UI.
---

# PERMA Honesty

## Never invent

- Chart series, TVL, APY, volume, order-book depth, liquidation distance (pre-P4), unrealized P&L.

## Prefer

- Empty / “Indexer unavailable” / “—” over placeholder curves.
- Hide chart panes when `/health` lagging or series empty (`INDEXER-AND-PRODUCT-UI.md`).
- Keep exact Prototype banner copy from COPY-DECK / PrototypeBanner.

## Allowed charts (real data only)

- Premium index series from indexer.
- Inventory by range from indexed positions / market summary.
- User premium / settlement history from indexer + RPC cross-check before risk actions.

