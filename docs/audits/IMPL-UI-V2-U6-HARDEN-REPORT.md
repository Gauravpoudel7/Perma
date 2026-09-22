# IMPL-UI-V2-U6 — Harden Report (a11y + performance)

> **Scope:** ranked fixes only, on the product UI U0–U5 built. No layout, feature, brand, protocol, IDL, instruction-builder or solvency-math change.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## Method
Read every shell / Trade / Portfolio / Vault entry point and the primitives; grepped `src` for interactive elements without `focus-ring`, `<label>`s without `for`, dialogs without traps, duplicate pollers, and any `lightweight-charts` import outside the dynamic chart modules. Wrote the punch-list below before editing; fixed P0/P1 and the two trivial P2s; deferred the rest with reasons.

Verified before fixing (no change needed): every `button` / `a` / `Link` in `src` carries `focus-ring` + `transition-brand`; `lightweight-charts` is imported only under `components/trade/charts/` (one type-only import in `series.ts`) and reaches the page through `next/dynamic({ ssr: false })`; both navs carry `aria-label="Primary"` + `aria-current`; disabled reasons are `aria-live="polite"`; `.transition-brand` honors `prefers-reduced-motion`; muted `#A1A1AA` on surface `#141414` ≈ 7.3:1 and danger `#EF4444` ≈ 5.2:1 (WCAG AA for UI text). Banner unchanged.

## Punch-list and outcomes

| # | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | P0 | The connect dialog (`WalletListModal`) had Esc but no focus trap, no initial focus, no focus return — the first overlay every user opens. | **Fixed.** Rebuilt on `primitives/SlideOver.tsx` (same copy, same wallet buttons); `ConnectButton` restores focus on close. Covered by a new keyboard e2e. |
| 2 | P1 | Trade "Position Size" `<label>`s bound to nothing; "Price Range" slider group unnamed. | **Fixed.** `htmlFor`/`id` on the size input; `role="group" aria-labelledby` on the range block; handles gain `aria-valuetext="tick {n}"`. |
| 3 | P1 | No skip link. | **Fixed.** "Skip to content" (`sr-only focus:not-sr-only`) first in DOM → `<main id="main" tabindex="-1">`. |
| 4 | P1 | Error toasts were `role="status"` (polite). | **Fixed.** Error variant is `role="alert"`. |
| 5 | P1 | `Skeleton` put `aria-label` on a bare `div`. | **Fixed.** `role="status"`. |
| 6 | P1 perf | Trade polled the same `RangePremiumState` three times (SizeInput, InventoryStrip, `useOpenPosition` each ran their own 15 s poller; U1 added the third). | **Fixed.** `useRangeState` split into `useRangeStatePoller` (mounted once in `TradePanel`) and `useRangeStateValue` (select only) used by the three readers. Portfolio rows keep polling — each is a different range. Three RPC reads per 15 s on Trade → one. |
| 7 | P2 | Body scrolled behind an open sheet. | **Fixed** (trivial): `SlideOver` sets `body.overflow = hidden` while open and restores it. |
| 8 | P2 | `PrototypeBanner.BANNER_HEIGHT_PX` had no runtime reader since U5. | **Fixed** (trivial): export removed; `tokens.css` comment points at the component. |
| 9 | P2 | `viewport-fit=cover` / real notched-device safe area. | **Deferred.** No Playwright evidence of a gap; the `env()` padding has a 0 fallback. Needs a real device (below). |
| 10 | P2 | Portfolio `<tr onClick>` is mouse-only. | **Deferred / accepted.** Every row has a keyboard-reachable "Details" button; adding row-level key handling would duplicate it. |

## E2E added — `e2e/keyboard.spec.ts`
- Skip link is the first Tab stop and Enter moves focus to `#main` (Chromium projects; WebKit skips, as the existing keyboard test does, because Safari does not Tab onto links by default).
- Connect dialog: Enter on Connect opens it, focus lands inside, six Tabs never leave it, Escape closes it and focus returns to Connect.
- Mobile: the "Market data" disclosure and a tab-bar link are focusable with a visible outline; Enter toggles the disclosure.
Existing "Connect within 8 tabs" still holds (skip link + five sidenav links + Connect on desktop; skip link + Connect on phones).

## Performance
- `/trade` first-load JS: 261 kB before and after (no bundle change; the perf fix is RPC traffic, not bytes).
- Charts remain client-only; the U5 disclosure toggles `hidden` and never remounts a chart; the U5 `ResizeObserver` refit is intact.
- No new fonts, no new dependencies.

## Docs
- `UI-QA-CHECKLIST.md`: new "Accessibility contract (UI V2, U6)" section.
- `docs/04-ui-ux/UI-V2-COMPLETE.md`: one-page Definition of Done for the product UI.

## Gate (from `apps/web`, 2026-09-22)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 7 files, 55 tests passed |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully; `/trade` 261 kB first load |
| `yarn test:e2e` | 80 passed, 8 skipped (WebKit keyboard/screenshot skips, all intentional) |
| Slop grep (`gradient\|backdrop\|shadow-\|#hex` in `src/components`, `src/app`, `src/hooks`) | only `shadow-none` on Toast and the RangeSlider doc comment |

## Manual debt (not blocking; carried through U0–U6)
1. **Wallet-connected localnet path** (never driven by Playwright — no wallet extension): connect → Trade nudge → Vault deposit → Review deposit → Confirm → TopBar Free updates and nudge clears → Open Short → ReviewSheet → Cancel (no wallet prompt) → Confirm → toast → Portfolio row → Details (sheet shows the row's figure) → Esc returns focus → Close / Settle → Vault withdraw above "withdrawable" blocked with the solvency alert → Max → Review withdrawal → Confirm.
2. **Real notched device**: safe-area inset under the banner, tab reach, sheet footer above the banner; decide on `viewport-fit=cover` only with a screenshot of a gap.
3. Screen reader pass (VoiceOver) on the connect dialog and the Trade ticket — the contracts above are structural, not yet listened to.
