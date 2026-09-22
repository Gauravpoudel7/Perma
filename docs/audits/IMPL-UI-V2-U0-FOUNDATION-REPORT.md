# IMPL-UI-V2-U0 — Foundation Report

> **Scope:** `apps/web` shell and shared UI states only. No `programs/**`, IDL, hook write-path, or transaction-semantics change. No chart library (U2).
> **Date:** 2026-09-21
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### Brand drift (fixes only)
- `Badge` warning tone used a raw `border-[#EF4444]`; now `border-danger`.
- `Button` hover colors were raw hex; two new tokens `--color-accent-hover: #e5e5e5` and `--color-danger-hover: #dc2626` added to `tokens.css`, `tailwind.config.ts`, and BRAND-SYSTEM.md (same PR, per brand-lock).
- `RangeSlider` styled-jsx handle color now reads `var(--color-text-primary)` instead of `#ffffff`.
- Markets page hand-rolled Paused/Open pills replaced with `Badge`.

### Shell density
- **TopBar** (`components/shell/TopBar.tsx`): one row — `PERMA` wordmark (overline) · "SOL/USDC · Orca Whirlpool" · `Spot {price} USDC` (mono, tabular) · Active/Paused badge (Paused carries the COPY-DECK paused copy as `title`) · `Free {sol} SOL · {usdc} USDC` when connected · Connect. Padding `px-4 py-2`. Below `md` the market label and free-collateral group hide; below `sm` the quiet "Active" badge hides ("Paused" always shows); the row is `flex-wrap` so a paused phone still cannot overflow.
- `useSpotPrice()` now mounts once in `AppShell` (it was mounted from `MarketHeader`); `MarketHeader` keeps the verbatim market label and no longer duplicates the spot number. The hook's comment was updated; it still reads the Orca Whirlpool and is always labeled "Spot".
- **Sidenav**: active link carries `aria-current="page"` and a 1px `border-text-primary` left rule on the existing `bg-surface`; rail padding reserves space for the fixed Prototype banner so the Docs link is no longer clipped. Icon rail below `md` unchanged; Tab order unchanged (`keyboard.spec.ts` still reaches Connect within 8 tabs).
- `AppShell` main padding `p-4 md:p-6`.

### Shared UI states — `components/primitives/States.tsx`
`Skeleton` (static block, `aria-busy`, `aria-label="Loading"` — no shimmer, because BRAND-SYSTEM allows only 100ms linear motion), `EmptyState`, `DegradedState` (`role="status"`), `InlineError` (`role="alert"`, optional recovery CTA slot).

Wired into: `EmptyPositions`, `InventoryEmptyState`, `HistoryTable` (loading / not configured / degraded / empty), Markets page (loading / no data / degraded), `CollateralSummary` (skeleton tiles before the first fetch). `ClusterGuard` banners now carry `role="alert"`. All existing copy strings are unchanged.

### Store: loading vs. absent
`useChainStore.collateralLoaded` (boolean) distinguishes "first `UserCollateral` fetch has not resolved" from "wallet has no collateral account". `useUserCollateral` resets it on wallet switch and sets it after each fetch. Read-only state; no transaction path consults it.

### Typography
New TopBar numbers use `text-mono-sm tabular-nums`. Slot / count numbers in `IndexedCharts` captions, `HistoryTable` watermark line, and the `RequiredFreeUsdcTile` hint (`DataTile` gained an optional `hintClassName`) are now tabular.

### Zero-collateral nudge — `components/trade/CollateralNudge.tsx`
Rendered at the top of `TradePanel` when connected, `collateralLoaded`, and `UserCollateral` is absent or all four balances are zero. Inline `role="status"` surface with the new COPY-DECK §4.4 copy and a "Go to Vault" link styled as the secondary button. No modal, no toast, no dismiss state; it disappears when `refetchAll` lands a non-zero account. `OpenPositionButton` guards are untouched.

### Docs
- `COPY-DECK.md` §4.4: added loading, indexer-unavailable, no-data and nudge strings; new §4.5 Top bar strings.
- `BRAND-SYSTEM.md`: hover tokens.
- `APP-SHELL.md`: Top Bar contents, Shared States, Post-connect Collateral Nudge.

## Deliberately not built (later phases)
- Trade desk CSS-grid layout, ReviewSheet, ticket polish — U1.
- Lightweight Charts + `/premium/series` pane — U2 (the existing SVG `IndexedCharts` is unchanged).
- Portfolio cards / slide-over — U3. Vault choreography — U4. Bottom tab bar — U5.
- Any payoff curve, Greeks, unrealized P&L, liquidation gauge, TVL/APY — never in Fair.

## Gate (run from `apps/web`, 2026-09-21)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 6 files, 50 tests passed |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully; all routes static |
| `yarn test:e2e` | 59 passed, 4 skipped (WebKit screenshot/keyboard skips are pre-existing and intentional) |
| Slop grep (`gradient\|backdrop\|shadow-\|#hex` in `src/components`, `src/app`) | only `shadow-none` on Toast and a doc comment in RangeSlider |

New e2e coverage in `e2e/shell.spec.ts`: on every route the TopBar shows a "Spot" readout and exactly one Sidenav link carries `aria-current="page"` pointing at the current route. The existing mobile no-horizontal-overflow test caught the first TopBar draft overflowing at 390px (scrollWidth 458); fixed by the wrap + hide rules above and re-verified green.

Screenshots in `docs/04-ui-ux/screenshots/` were regenerated by the e2e run — the change is intentional (new TopBar, active-nav rule).

Method note: an unrelated `next-server` left over on port 3001 from a previous session was reused by Playwright and served a stale `.next` after `yarn build`, producing unstyled screenshots. It was stopped and Playwright started its own dev server; all numbers above are from that clean run.

## Manual verification still owed
The wallet-connected paths (nudge appears for a fresh wallet, disappears after deposit; TopBar "Free" updates; mint/close/deposit/withdraw unchanged) need a browser wallet against localnet and were not driven by Playwright in this pass. No code on those transaction paths was modified (`useSendPermaTx`, `useWalletGuard`, `OpenPositionButton`, deposit/withdraw forms are byte-identical apart from the shared-state imports in `CollateralSummary`).
