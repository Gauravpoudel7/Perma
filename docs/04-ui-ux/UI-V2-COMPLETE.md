# PERMA Product UI V2 — Definition of Done (U0–U6)

> Product app only (`/trade`, `/portfolio`, `/vault`, `/markets`). This page says what the UI does and promises; it makes no claim about the protocol.
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What each phase delivered
| Phase | Delivered | Report |
|---|---|---|
| U0 Foundation | Dense TopBar (market label · Spot · status · Free collateral), Sidenav active state, shared `Skeleton` / `EmptyState` / `DegradedState` / `InlineError`, `collateralLoaded`, Trade zero-collateral nudge, hover tokens | `audits/IMPL-UI-V2-U0-FOUNDATION-REPORT.md` |
| U1 Trade desk | Viz pane + 384px ticket grid, `InventoryStrip`, range presets, windowed slider, visible disabled reason, `ReviewSheet` before mint, `useOpenPosition`, open-positions strip | `…U1-TRADE-DESK-REPORT.md` |
| U2 Charts | Lightweight Charts v5, client-only: premium index over slots with an RPC reference line; inventory by range with the selected-range marker; honest empty / degraded states | `…U2-CHARTS-REPORT.md` |
| U3 Portfolio | Table → cards from one DOM, `PositionDetail` sheet, shared `SlideOver`, `usePositionSummary`, History "When" | `…U3-PORTFOLIO-REPORT.md` |
| U4 Vault | Tile hierarchy, `useRequiredFreeUsdc`, Max + "withdrawable" line, bordered gate alerts, review deposit / withdrawal sheets | `…U4-VAULT-REPORT.md` |
| U5 Mobile | Tab bar stacked above the banner, sidenav `md+`, Trade "Market data" disclosure, sheet/toast clearance, 24px slider thumbs | `…U5-MOBILE-REPORT.md` |
| U6 Harden | Connect dialog on `SlideOver`, skip link, labels, live-region roles, single range poller, scroll lock, keyboard e2e | `…U6-HARDEN-REPORT.md` |

## Standing contracts
- **Honesty**: every number is an RPC read, an indexer row, or "—" / a sentence. No chart series, TVL, APY, depth, Greeks, unrealized P&L or liquidation figure exists in the UI. Labels are grep-tested in e2e on every route. The Prototype banner is verbatim, bottom-most, on every route.
- **No-break**: `programs/**`, the IDL, instruction builders, `useSendPermaTx`, `useWalletGuard` and `lib/solvency.ts` were not modified by any UI phase. Every write path still re-reads open longs fresh before building an instruction.
- **Brand**: all color / type / spacing / radius from `tokens.css`; no hex in components (RangeSlider reads the token); no gradients, blur, shadows, radius > 8px; motion 100 ms linear with reduced-motion off-switch.
- **Accessibility**: see `UI-QA-CHECKLIST.md` → "Accessibility contract".
- **Responsive**: 1440×900 desk and 390×844 phone are both Playwright-verified on every change (overflow, banner, chrome, keyboard).

## Gate (must stay green)
```bash
cd apps/web && yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
At U6: typecheck clean · 55 unit · copy clean · build clean · 80 e2e passed, 8 intentional WebKit skips.

## Open manual debt
Wallet-connected localnet walkthrough, real notched-device safe-area check, VoiceOver pass — listed with steps in the U6 report. None of these are blocked by code; they need a wallet, a phone, and a screen reader.
