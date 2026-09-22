# IMPL-UI-V2-U1 — Trade Desk Report

> **Scope:** `/trade` layout, ticket, review step. No `programs/**`, IDL, or transaction-semantics change. No chart library (U2).
> **Date:** 2026-09-21
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### Desk grid — `components/trade/TradePanel.tsx`
- ≥1280px: viz pane (flex) + 384px ticket, side by side. 768–1279px: stacked, viz first. <768px: ticket first (DOM order + `order-*`).
- The `mx-auto max-w-xl` card is gone; the stage uses the shell width.
- `app/trade/page.tsx` always renders the desk. Inventory and charts are public RPC/indexer reads; only the CTA needs a wallet, and that slot shows the verbatim "Connect a wallet to continue." while disconnected — so `disconnected.spec.ts` ("no Open Short/Long button") stays green unchanged, and Playwright can now assert and screenshot the real desk.

### Viz pane
- New `InventoryStrip.tsx`: short / long / available liquidity for the selected range from the same `useRangeState` read `SizeInput` gates on, with the realized price range and ticks. A range with no account shows `0` (its liquidity is zero) plus the verbatim empty-inventory sentence. Labeled inventory; never order book or depth.
- `IndexedCharts.tsx` no longer returns `null` when there is nothing to draw. It renders, in order: `EmptyState` (indexer not configured) → `Skeleton` (loading) → `DegradedState` (indexer down) → `EmptyState` (nothing indexed) → the existing SVG figures. Drawing rules (≥2 points, `historyComplete`, non-zero buckets) are unchanged.

### Ticket
- Card order: `CollateralNudge` → "Open Position" (h1, `text-h4`) + market label → `SideToggle` → `RangeInput` → `SizeInput` → `PremiumPreview` → visible disabled reason (`aria-live="polite"`) → CTA.
- `RangeInput`: "Around spot" ±8 / ±32 / ±128 tick-spacing presets (snap `spot.tickCurrentIndex` to spacing, open ±n spacings, clamp to the tick domain) calling the existing `setRange`. The slider is now windowed to ±512 spacings around spot (widened to include the current range) — on the full ±443636 domain the default 2000-tick range rendered as a single pixel and both handles overlapped.
- `PremiumPreview` and the review sheet share one function, `lib/solvency.estPremiumPerHour` (unit-tested), instead of two copies of the arithmetic.
- `MarketHeader` is a muted label under the ticket title; the TopBar still owns Spot.

### Review before mint
- New `hooks/useOpenPosition.ts`: the guard chain (`useWalletGuard` → size → inventory → `MAX_OPEN_LONGS` → `canMintLong`) and both instruction builders were moved out of `OpenPositionButton.tsx` verbatim. The hook also returns a `summary` computed from exactly the inputs `handleOpen` will send: realized range, size, `slippageCappedTokenMax` caps (short), `requiredMargin` + free USDC + est. premium/hour (long), and whether a tick array is missing.
- New `ReviewSheet.tsx`: right-anchored slide-over (APP-SHELL "no pop-ups"), 1px left border, no radius on the edge, no shadow, solid-alpha scrim like `WalletListModal`. Esc closes; Tab/Shift+Tab wrap inside; focus returns to the CTA on close (`Button` now forwards its ref). "Cancel" aborts before any wallet prompt; "Confirm Open Short/Long" closes the sheet and runs the unchanged `handleOpen`, so the existing "Confirm in your wallet" toast flow takes over.
- Not shown anywhere: Greeks, delta, max loss, unrealized P&L, liquidation distance, depth.

### Open positions strip — `OpenPositionsStrip.tsx`
Up to 5 live positions (side, range, size, Open / Pending Premium) with a "View in Portfolio" link. No premium column (that math stays in `PositionRow`), no P&L. Hidden when disconnected or empty.

### Docs
- `COPY-DECK.md` §4.1: presets, disabled reasons, review sheet, inventory strip, chart-pane states, positions strip.
- `APP-SHELL.md` §1: desk grid, viz pane, ticket order, ReviewSheet, positions strip.

## Deliberately not built
- Lightweight Charts and the range-band overlay — U2.
- Portfolio cards / slide-over — U3. Vault choreography — U4. Bottom tab bar — U5.
- Payoff curve, Greeks, multi-leg, liquidation gauge, order book — never in Fair.

## Gate (from `apps/web`, 2026-09-21)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 6 files, 51 tests passed (+1 `estPremiumPerHour`) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 65 passed, 4 skipped (pre-existing WebKit skips) |

New e2e in `e2e/shell.spec.ts`: on desktop the ticket is 360–400px wide and to the right of the viz pane; on mobile the ticket is above the viz pane; no heading, figure title, field label or table header on `/trade` contains "order book", "depth", "P&L", "delta", "greeks" or "liquidation" (the inventory caption's honest "not order book depth" disclaimer is body text, not a label, and is allowed). Existing overflow, banner, keyboard-focus and disconnected specs unchanged and green.

Screenshots regenerated (intentional: desk layout).

## Manual verification still owed (carried from U0)
Wallet-connected flow on localnet: connect → nudge → deposit → TopBar Free → Open Short → ReviewSheet → Cancel (no wallet prompt) → Confirm → wallet prompt → toast; Esc closes the sheet and focus lands on the CTA. Not driven by Playwright (no wallet extension). Transaction-building code moved files but did not change; `useSendPermaTx`, `useWalletGuard`, `lib/perma.ts`, `lib/resolvePosition.ts`, `lib/tickArray.ts` untouched.
