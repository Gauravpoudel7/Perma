# IMPL-UI-V2-U2 — Charts Report

> **Scope:** the Trade viz pane's two figures. No `programs/**`, IDL, or transaction-semantics change. U1 desk, ReviewSheet, InventoryStrip, OpenPositionsStrip untouched.
> **Date:** 2026-09-21
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### Dependency
`lightweight-charts@^5.2.1` added to `apps/web` (root `yarn.lock` updated; pulls `fancy-canvas`). No other chart library, no TradingView widget.

### Chart modules — `components/trade/charts/`
- `theme.ts` — `readChartTokens()` reads `--color-bg/-surface/-border/-text-primary/-text-muted` and `--font-mono` from the document at mount; `chartOptions()` maps them to LWC layout / grid / crosshair / scale options (solid surface background, border-color grid, mono axis text, `attributionLogo: false`). No color literal exists in the chart code.
- `useLwcChart.ts` — `createChart(el, { autoSize: true, …theme, …extra })` in an effect; `chart.remove()` on unmount. Width follows the U1 viz column through LWC's own ResizeObserver; height is fixed CSS (`h-56` premium, `h-40` inventory).
- `series.ts` — pure mappers, unit-tested in `test/chartSeries.test.ts`:
  - `toPremiumLineData`: dedupe by slot (last row wins), sort ascending, `Number(BigInt(indexValue))`. `Number` is exact below 2^53; at the deployed 1e6/slot rate that is ~9e9 slots (~114 years), noted in a comment.
  - `toInventoryHistogramData`: bucket ordinal → bar, short/long arrays, the ordinal of the bucket equal to the ticket's range (or `null`).
- `PremiumIndexChart.tsx` — one `LineSeries`, `pointMarkersVisible` so every recorded row keeps its dot (same honesty as the SVG: the line is a connector). Time axis and crosshair are formatted as `slot {n}`; `blockTime` is often null and the chain's clock is the slot. When the polled `GlobalPremiumIndex` is present, a dashed `createPriceLine` titled "Live index (RPC)" shows the current on-chain value — a second real source that makes indexer lag visible.
- `InventoryChart.tsx` — two `HistogramSeries` (short muted, long white on top; a long never exceeds its range's short, so the nested bar reads as "taken"), x labels `[lower, upper]`, scroll/scale disabled, one `createSeriesMarkers` arrow "Selected range" on the bucket equal to the ticket's `tickLower/tickUpper`.

### `IndexedCharts.tsx`
The SVG drawing (`PremiumSeriesChart`, `InventoryByRange`, `scale`, `W/H/PAD`) is deleted. The fetch and state ordering are unchanged: not configured → `EmptyState`; loading → `Skeleton`; nothing drawable + degraded → `DegradedState`; nothing drawable → `EmptyState`; else figures. Drawing rules unchanged: ≥2 points for the series, `historyComplete` and non-zero buckets for inventory. Both chart components load through `next/dynamic({ ssr: false })` with a `Skeleton` fallback; the production build proves nothing imports the library on the server. Captions keep "Premium index" / "Inventory by range" and the "inventory, not order book depth" sentence; the U1 e2e label ban still passes.

### Range band — how ticks map to an axis
- **Inventory chart:** direct. Each bar is one tick range; the ticket's `(tickLower, tickUpper)` selects one bar and gets the arrow. No projection, no interpolation.
- **Premium chart:** deferred. Its axes are slot × index value. A tick range has no honest position on either axis, and adding a secondary price axis would require drawing a price series this pool has not indexed. No band is drawn there.

### Docs
- `COPY-DECK.md` §4.1: chart figure strings (axis label forms, "Live index (RPC)", "Selected range", both captions).
- `APP-SHELL.md` §1 viz-pane bullet rewritten for the canvas charts and the mapping above.

## Deliberately not built
- User premium history chart: the indexer's `/positions/{owner}/history` returns settlement rows, but no series endpoint exists; rather than assemble one client-side, it stays a table in Portfolio (U3 may revisit).
- Payoff curve, Greeks, order book, liquidation, TVL/APY — never in Fair.
- Portfolio / Vault charts — out of scope by the brief.

## Gate (from `apps/web`, 2026-09-21)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 7 files, 55 tests passed (+4 chart mappers) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully; `/trade` first-load 261 kB (was 257 kB) |
| `yarn test:e2e` | 68 passed, 4 skipped (pre-existing WebKit skips) |
| Slop grep on `components/trade/charts/**`, `IndexedCharts.tsx` | no hex, gradient, backdrop or shadow |

New e2e (`e2e/shell.spec.ts`, "Trade charts"): if the viz pane has a "Premium index" figure it contains a `canvas` and no `svg polyline`; otherwise one of the three COPY-DECK chart-pane sentences is visible. All U0/U1 tests unchanged and green. Test fixtures in `test/chartSeries.test.ts` are synthetic and imported by nothing under `src/`.

Visual check (desktop 1440×900 screenshot, local indexer on 8799): 128-point premium series with the RPC reference line; single-bucket inventory bar with the arrow on the selected range. Three adjustments after the first render: price-scale labels use compact notation ("2.21B") because full integers took 40% of a 390px viewport (exact values stay in the caption and the inventory strip), the series' last-value axis label is hidden when the RPC line is present (they printed the same number on top of each other), and the inventory price scale has 30% top margin so the marker sits above the tallest bar.

Screenshots regenerated (intentional: canvas charts replace SVG).

## Manual verification still owed (carried from U0/U1)
Wallet-connected flow on localnet (nudge → deposit → Review → Confirm). Charts need no wallet and were verified without one.
