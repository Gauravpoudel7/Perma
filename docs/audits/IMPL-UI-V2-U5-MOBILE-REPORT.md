# IMPL-UI-V2-U5 — Mobile Report

> **Scope:** shell information architecture and touch polish below 768px. No `programs/**`, IDL, hook, or transaction change. ≥768px unchanged.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### Shell chrome
- New `components/shell/MobileTabBar.tsx`: Trade · Portfolio · Vault · Markets as text links (no icon set), `aria-current="page"` from the pathname, 44px rows, 1px top rule, solid background — no blur, no shadow. `md:hidden`.
- `AppShell.tsx` renders one fixed bottom stack (`z-50`): the tab bar over the `PrototypeBanner`. The banner is no longer independently fixed; it is the last child of that stack, so it is always bottom-most and never covered, and its two-line phone wrap needs no height guess for the tab bar to sit on. `<main>` bottom padding is now class-based: `--shell-banner-h + --shell-tabbar-h + 1rem` on phones, `--shell-banner-h + 1.5rem` from `md`.
- `tokens.css`: `--shell-banner-h` (40px; 52px below 768px for the wrapped banner) and `--shell-tabbar-h` (56px) — layout constants, commented as not brand tokens. `PrototypeBanner.BANNER_HEIGHT_PX` remains the single-line JS twin.
- `Sidenav.tsx`: `hidden md:flex`; the U0 letter rail and the dead `collapsed` prop are gone. Desktop markup unchanged (Docs link stays). Both navs are labeled "Primary"; only one is ever visible.
- `ToastContainer.tsx`: toasts now clear the tab bar + banner (they previously overlapped the banner).

### Trade disclosure — `TradePanel.tsx`
A `md:hidden` "Market data" button (`aria-expanded`, `aria-controls="trade-viz"`, "Show" / "Hide") toggles local state; the viz section's class is `hidden`/`flex` plus `md:flex`, so from `md` the pane is always visible and the button never renders. One DOM, one chart instance. The wrapper is `md:contents`, so the desk grid still receives the section as a direct grid item at `xl`.

`charts/useLwcChart.ts`: a `ResizeObserver` on the chart container calls `timeScale().fitContent()` whenever the box has a real width. Found by screenshot: a chart mounted inside the closed disclosure had run its only `fitContent` at 0px and opened squeezed to the right edge.

### Sheets and touch
- `SlideOver.tsx`: panel pads its bottom by `--shell-banner-h + env(safe-area-inset-bottom)` below `md`, so Cancel / Confirm sit above the banner; the scrim (z-50) covers the tab bar, so tabs cannot be tapped while a sheet is open. Esc, Tab wrap, focus return unchanged.
- `RangeSlider.tsx`: 24px thumbs under `@media (pointer: coarse), (max-width: 767px)`; track and the 48px row unchanged; radius stays the one allowed `radius-full` use.

### Docs
`APP-SHELL.md` gains "Mobile product mode (<768px)"; `COPY-DECK.md` gains §4.5 Navigation (nav labels, "Market data" / "Show" / "Hide"); the top-bar section is now §4.6.

## Deliberately not built
PWA manifest / install prompt, `viewport-fit=cover` (safe-area padding already has a 0 fallback; revisit only if a real device shows a gap), swipe-to-close, native bottom-sheet physics, icon packs — all deferred per MOBILE-U5-RESEARCH §4.

## Gate (from `apps/web`, 2026-09-22)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 7 files, 55 tests passed |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 77 passed, 4 skipped (pre-existing WebKit skips) |

New e2e (`e2e/shell.spec.ts`, "Shell chrome by breakpoint"): mobile — tab bar visible with four links and "Trade" current, sidenav hidden, tab bar bottom ≤ banner top, banner bottom within the 844px viewport, "Market data" starts `aria-expanded=false` with the viz hidden and opens on tap; desktop (Chromium + WebKit) — sidenav visible, tab bar and disclosure hidden. The U1 desk-width and U2 chart tests open the disclosure on the mobile project before measuring. Banner-text, overflow, keyboard-focus, nav, label-ban specs unchanged and green.

The first run of the new test failed on the stacking assertion (tab bar bottom 804 vs banner top 794): the banner wraps to two lines on a phone, so a fixed 40px offset overlapped it. Fixed by stacking the two in one fixed wrapper instead of positioning the tab bar by a constant.

Screenshots regenerated (intentional): phone pages now show the tab bar over the banner, no rail, and Trade's closed disclosure; desktop unchanged. A scratch screenshot with the disclosure open (not committed) confirmed the charts size and fit correctly.

## Manual verification still owed (carried forward)
Real notched device: safe-area inset under the banner, tab reach, sheet footer above the banner. Wallet-connected flow from U0–U4 still owed.
