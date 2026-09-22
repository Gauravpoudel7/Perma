# CLAUDE-IMPLEMENT-UI-V2 — Phase U5 Mobile

> **Product UI only** (Trade / Portfolio / Vault / Markets). Not landing page.  
> **Read first:** `docs/04-ui-ux/MOBILE-U5-RESEARCH.md` (mandatory), `PRODUCT-UI-V2-RESEARCH.md` §5, `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md`, `COPY-DECK.md` §1 + nav labels, U0–U4 IMPL reports, skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman.  
> **Model:** strongest available for visual work (Opus).

## Goal

Ship **mobile product mode** (<768px): thumb-reachable bottom tabs, ticket-first Trade with charts behind disclosure, 44px targets — **without** breaking the ≥768 sidenav desk, without covering the honesty banner, and without protocol changes.

U0–U4 already delivered shell density, Trade desk, LWC charts, Portfolio cards/SlideOver, Vault reviews. U5 is information architecture + touch polish.

## Locked research decisions (do not reopen)

1. **Stack `MobileTabBar` above `PrototypeBanner`.** Banner stays bottom-most, verbatim, always visible. Tabs sit directly above it. Main `padding-bottom` = tabs + banner + `env(safe-area-inset-bottom)`.
2. **Hide left `Sidenav` below `md`.** No letter-rail + tabs double chrome. Sidenav unchanged `md+`.
3. **Tabs:** Trade · Portfolio · Vault · Markets (text labels; **no new icon library**).
4. **Trade <768:** keep ticket-first; wrap viz (`InventoryStrip` + `IndexedCharts`) in a disclosure default **closed**.
5. **No PWA / native app** in U5.

See `MOBILE-U5-RESEARCH.md` for peer rationale and risks.

## Current surface

| Piece | Path | Notes |
|---|---|---|
| Shell | `AppShell.tsx` | Pads for banner only today |
| Nav | `Sidenav.tsx` | Letter rail <md — replace with tabs |
| Banner | `PrototypeBanner.tsx` | Fixed bottom; keep |
| Trade | `TradePanel.tsx` | `order-1` ticket already |
| Sheets | `SlideOver.tsx` | `w-full` on phone; raise z above tabs when open |
| Slider | `RangeSlider.tsx` | Enlarge hit area on mobile |

## In scope

1. **`MobileTabBar` (new)** — fixed, <md only; four routes; `aria-current`; min 44px; focus-ring; border-top 1px; solid bg (no blur/glass); labels from COPY-DECK.
2. **AppShell** — compose TabBar + Banner; export/share height constants; update main + any sidenav bottom padding.
3. **Sidenav** — `hidden md:flex` (keep Docs link on desktop sidenav).
4. **Trade mobile disclosure** — “Market data” collapsed by default <768; open on `md+` always visible as now.
5. **Touch** — RangeSlider handles ≥44px on coarse pointers / <md; primary Button full-width rows already OK — verify tab + sheet footers clear chrome.
6. **SlideOver** — `z-index` above tab bar; when open, tabs are not clickable underneath; Esc/focus trap unchanged.
7. **TopBar** — fix any overflow with tabs+banner; do not re-introduce U0 phone overflow.
8. **E2E** — mobile: tab bar visible, sidenav absent, banner text exact, no horizontal overflow, Trade disclosure present; desktop: sidenav present, tab bar absent, desk grid still holds.
9. **Docs** — APP-SHELL mobile section; COPY-DECK tab strings; `docs/audits/IMPL-UI-V2-U5-MOBILE-REPORT.md`.

## Out of scope / Forbidden

- `programs/**`, IDL, tx semantics.
- Moving or dismissing honesty banner; abbreviating its text.
- PWA, install prompts, swipe-to-close positions, native bottom-sheet libraries.
- Icon packs, glass/blur tabs, soft shadows, radius > 8px.
- Fake metrics / multi-leg / order books / APY.
- Breaking U1 desk ≥1280 or U2–U4 features.

## Acceptance

- [ ] 390×844: bottom tabs + banner both visible; content not trapped under chrome.
- [ ] 1440×900: sidenav + desk unchanged; no tab bar.
- [ ] Trade phone opens on ticket; market data disclosure closed until user opens.
- [ ] SlideOver covers tabs; a11y preserved.
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green.
- [ ] Screenshots updated intentionally; IMPL report written.

## Method

1. Read `MOBILE-U5-RESEARCH.md` + shell components before coding.
2. Implement shell IA first (tabs + padding + hide sidenav), then Trade disclosure, then touch/z-index, then e2e.
3. Prefer CSS breakpoints over resize listeners (SSR-safe, matches U0 sidenav lesson).
4. Kill stale next on 3001 if e2e CSS breaks.
5. Anti-slop grep; verify no backdrop-blur on tab bar.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
