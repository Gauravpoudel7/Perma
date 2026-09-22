---
name: perma-fair-surface
description: Use this when designing PERMA Trade/Portfolio UI. Limits UI to Fair+P1+P2 capabilities; blocks premature P4/P5 chrome.
---

# PERMA Fair Surface (UI)

## In scope now

- Single-leg range mint (short/long), vault collateral, portfolio close/settle.
- Pause banner / allow-while-paused rules.
- Indexer-backed history and premium series (P2).
- Admin-derived status display (paused) — not new admin UI unless asked.

## Out of scope (do not build fake chrome)

- Multi-leg strategy templates, Greeks, iron condors (P5).
- Liquidation distance / health meter (P4).
- Commission APY tiles (deferred).
- Raydium / non-Orca markets (charter).
- Mainnet “production ready” marketing.

If a peer app shows a control PERMA cannot back with chain/indexer data, omit it or show disabled with honest reason — never simulate.

