# CLAUDE-IMPLEMENT-UI-V2 — Phase U2 Charts (real data)

> **Product UI only** (Trade / Portfolio / Vault). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (§4 Charting, §7 U2), `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md`, `COPY-DECK.md` §4.1, U0+U1 reports (`docs/audits/IMPL-UI-V2-U0-FOUNDATION-REPORT.md`, `IMPL-UI-V2-U1-TRADE-DESK-REPORT.md`), and skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman. Optionally install the TradingView Lightweight Charts agent skill (`npx skills add https://github.com/tradingview/lightweight-charts -a claude-code -y`) if missing.  
> **Model:** strongest available for visual + chart API work (Opus).

## Goal

Replace the Trade viz SVG stub with **TradingView Lightweight Charts v5**, fed only by real indexer series. Keep U1 desk layout, ReviewSheet, InventoryStrip, and mint semantics. Prefer empty / degraded states over any fabricated series.

## Current surface (evolve)

| Piece | Path | Notes |
|---|---|---|
| Desk | `components/trade/TradePanel.tsx` | U1 grid — keep |
| SVG charts | `components/trade/IndexedCharts.tsx` | Honest SVG; **replace drawing** with LWC host; keep data fetch / empty / degraded choreography |
| Inventory strip | `InventoryStrip.tsx` | Live RPC range inventory — keep (not a chart) |
| Indexer API | `lib/indexerApi.ts` | `fetchPremiumSeries`, market detail / range buckets already exist |
| Hook | `hooks/useIndexer.ts` | Reuse |
| States | `primitives/States.tsx` | Skeleton / Empty / Degraded |

## In scope

1. **Dependency**
   - Add `lightweight-charts` (v5) to `apps/web` only. No other chart libs. Do not add Recharts / Chart.js / TradingView widget.

2. **Client-only chart host**
   - New module(s) under `components/trade/charts/` (or equivalent), loaded via `next/dynamic(..., { ssr: false })`.
   - `ResizeObserver` (or chart `autoSize` if available) so the pane fills the U1 viz column.
   - Theme from CSS tokens (`--color-bg`, `--color-surface`, `--color-border`, `--color-text-primary`, `--color-text-muted`, accent if needed). No raw hex outside token mapping. No gradients / soft shadows on the chrome around the chart.
   - Dispose chart on unmount; avoid leaks across route changes.

3. **Allowed series (indexer only)**
   - **Premium index** over time from `/premium/series` (existing `fetchPremiumSeries` / points).
   - **Inventory by range** as histogram / bar series from real range buckets (same honesty rules as today’s SVG: non-zero / real buckets only).
   - Optional: user premium history **only if** an existing indexer endpoint already returns it; do not invent an API or mock rows.
   - **Range band overlay** for the ticket’s selected `tickLower`/`tickUpper` (and/or realized range): horizontal price/tick guides or a shaded band on the premium or a secondary price axis — only if you can map ticks/prices honestly from existing spot/range helpers. If mapping is ambiguous, ship guides as labeled tick lines and document the mapping in the IMPL report rather than inventing a payoff curve.

4. **Honesty / empty states (hard)**
   - If indexer not configured → `EmptyState` (existing copy).
   - Loading → `Skeleton`.
   - Indexer unhealthy / fetch fail → `DegradedState` ("Indexer unavailable" / existing COPY-DECK).
   - Series empty or < minimum points needed to draw → `EmptyState` / hide chart pane content — **never** a flat fake line, random walk, or demo candles.
   - Captions must not say order book, depth, TVL, APY, Greeks, unrealized P&L, liquidation.
   - Keep the U1 e2e ban on those words in headings/labels.

5. **Wire into Trade desk**
   - Viz pane still: InventoryStrip + chart host (replace SVG figures inside `IndexedCharts` or rename clearly; update imports in `TradePanel`).
   - Do not break desktop 384px ticket / mobile ticket-first order.
   - Portfolio / Vault: out of scope unless a tiny reuse of the host is trivial; default = Trade only.

6. **Docs + copy**
   - Update `APP-SHELL.md` viz / chart section.
   - COPY-DECK §4.1 chart-pane strings if new labels appear; `check-copy` green.
   - Report: `docs/audits/IMPL-UI-V2-U2-CHARTS-REPORT.md`.

## Out of scope / Forbidden

- `programs/**`, IDL, mint/deposit/withdraw/settle/burn semantics.
- Fabricated series, demo mode toggles that draw fake data, payoff/Greeks charts, multi-leg, liq gauges, order books.
- Full TradingView Advanced Charts widget / iframe.
- Regressing U1 ReviewSheet, InventoryStrip, OpenPositionsStrip, or desk grid.
- Portfolio / Vault redesign (U3/U4); mobile bottom tabs (U5).
- Glass, gradients, soft shadows, radius > 8px, raw spacing drift.

## Acceptance

- [ ] `lightweight-charts` v5 in `apps/web`; charts load client-only with no SSR crash.
- [ ] Premium series and inventory buckets render from real indexer data when present.
- [ ] Empty / loading / degraded paths never draw placeholder series.
- [ ] U1 desk layout + ReviewSheet + gates still green.
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green in `apps/web`.
- [ ] Playwright 1440×900 and 390×844: no horizontal overflow; screenshots updated only if intentional.
- [ ] Report at `docs/audits/IMPL-UI-V2-U2-CHARTS-REPORT.md` (include how range band maps ticks→axis, or why deferred).

## Method

1. Read `IndexedCharts.tsx`, `indexerApi.ts`, U1 report, and Lightweight Charts React/advanced tutorials before coding.
2. Install dep → build thin `ChartHost` → port premium series → port inventory → optional range band → delete dead SVG drawing code once parity exists.
3. Prefer one chart instance per figure (premium vs inventory) over overcrowding a single pane.
4. Run gates often. Kill stale `next-server` on 3001 if e2e serves broken CSS (U0 lesson).
5. Anti-slop grep on touched files; confirm no fabricated fixtures in unit tests that the UI would treat as live series (test helpers must stay clearly fake and off the product path).

## Notes from U0 / U1

- Indexer prefer port **8799** (avoid headroom 8787).
- InventoryStrip is RPC live liquidity — keep it; LWC inventory chart is the indexed bucket view, labeled inventory.
- Wallet-connected manual path still owed; charts must not require a wallet.
- Dynamic import keeps Playwright/SSR stable; if e2e needs a wait, assert on figcaption / DegradedState text already in COPY-DECK.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
