# PERMA UI V2 — U5 Mobile Research Brief

> **Date:** 2026-09-22  
> **Purpose:** Ground Phase U5 (Mobile product mode) before implementation.  
> **Status:** Research for product UI only. Not a protocol change. Prototype honesty rules still bind.

---

## 1. Where mobile is today (code truth)

| Area | Today | Gap |
|---|---|---|
| Shell | Left `Sidenav` collapses to **letter icon-rail** below `md` (`w-14`). | Letters (T/P/V) are weak wayfinding; rail still steals horizontal space at 390px. |
| Honesty banner | `PrototypeBanner` **fixed bottom**, `z-40`, `env(safe-area-inset-bottom)`, `BANNER_HEIGHT_PX=40`. Main pads for banner. | Any bottom tab bar **collides** unless stacked or banner moves. |
| Trade | U1 `order-*`: ticket first <768; viz/charts second. Desk ≥1280 unchanged. | Charts still compete with ticket on a short phone; no accordion/tab. |
| Portfolio | U3: table→cards via one DOM; `SlideOver` already `w-full` on phone. | Touch targets mostly OK; no bottom IA. |
| Vault | U4: stacked forms <md; review sheets. | Same. |
| QA | Playwright `mobile-chromium` 390×844: overflow, banner, screenshots green. | Emulation ≠ real iOS Safari / home-indicator stress. |
| PWA / native | None. `layout.tsx` has no `viewport-fit=cover`. | Out of U5 must-have; note for U6 if needed. |

Sources: `AppShell.tsx`, `Sidenav.tsx`, `PrototypeBanner.tsx`, `TradePanel.tsx`, `SlideOver.tsx`, `UI-QA-CHECKLIST.md`, `PRODUCT-UI-V2-RESEARCH.md` §5, `IMPL-UI-V2-U0…U4` reports.

---

## 2. Peer patterns (adapt vs reject)

### Adapt
- **Bottom primary nav on phone** (Hyperliquid mobile guides: Home/Markets/Trade/Portfolio-style bottom bar; collapsible panels). Map PERMA to **Trade · Portfolio · Vault · Markets**.
- **Ticket-first / chart secondary** (Aevo reviews: phone is check + simple ticket; options density stays desktop). Matches existing U1 `order-1` ticket.
- **Progressive disclosure** (Hyperliquid UX case study / interface guides): hide advanced under disclosure — for PERMA: exact ticks / rent stay available but chart pane collapses by default on <768.
- **Large touch presets** (HL design notes: 25/50/100%): PERMA already has Around-spot ±8/±32/±128 — keep; enlarge slider handles to ≥44px hit area.
- **Review-before-submit** (already U1/U4 SlideOvers): keep; full-width sheet on phone is correct.

### Reject / do not copy
- **Native app / feature parity push** (Aevo 2026 app marketing, HL Android app): PERMA U5 = responsive web only. No store build, no push.
- **Order books, unrealized PnL, liq prices, Greeks** (HL/Aevo chrome): forbidden by honesty + Fair surface.
- **Glass / soft shadow tab bars** (common PWA tutorials, Liquid Glass fashion): banned by BRAND-SYSTEM / UI-QA.
- **Panoptic multi-leg / strategy templates on phone**: Panoptic is desktop-first; P5 not in Fair.
- **Replacing the honesty banner** with a dismissible chip: COPY-DECK §1 forbids truncation/dismiss; wrap to two lines OK.

Sources: Aevo App Store / reviews 2026; Hyperliquid interface guides + UX case study (bnsx3801); PRODUCT-UI-V2-RESEARCH peer table; COPY-DECK §1; BRAND-SYSTEM.

---

## 3. Locked decision: banner vs bottom tabs

**Decision: stack `MobileTabBar` above `PrototypeBanner`.**

```
┌─────────────────────┐
│ TopBar (compact)    │
│ main (scroll)       │
├─────────────────────┤
│ MobileTabBar  z-40  │  ← new, <md only
├─────────────────────┤
│ PrototypeBanner     │  ← stays bottom-most, verbatim
│ + safe-area inset   │
└─────────────────────┘
```

Why:
1. COPY-DECK requires a persistent shell bar visible without scrolling — **not** a specific edge. Keeping it bottom-most preserves “always honest, never buried under chrome.”
2. Tabs remain thumb-reachable above the banner.
3. Main `padding-bottom` = tabBarHeight + bannerHeight + safe-area (single calc in AppShell).
4. Moving banner to top is a valid alternate but reshuffles ClusterGuard/TopBar and risks looking like a toast; stacking is less behavioral change.

**Also:** hide left `Sidenav` entirely below `md` when tab bar mounts (do not keep letter rail + tabs).

---

## 4. U5 scope

### Must
1. `MobileTabBar` (<md): Trade / Portfolio / Vault / Markets — text labels (no new icon library; brand already zero icon deps). `aria-current`, 44px min height, focus rings, `transition-brand`.
2. Hide `Sidenav` below `md`; keep full sidenav `md+` (desktop desk untouched).
3. AppShell padding accounts for **tabs + banner + safe-area**.
4. Trade <768: ticket-first (already); **charts/inventory in a collapsed `<details>` / disclosure** default closed (“Market data”) so first paint is the ticket.
5. RangeSlider / primary CTAs: ≥44px touch targets on mobile.
6. SlideOvers: confirm full-bleed on phone; footer actions not under banner/tabs (sheet `padding-bottom` or higher z-index than tabs; sheets should cover tabs while open — `z-50`+).
7. TopBar mobile: keep Spot + Connect + Paused; free collateral can stay hidden <md (U0); no overflow regression.
8. Playwright 390×844: no horizontal overflow; banner exact text; tab bar visible; desktop 1440 sidenav still present / no tab bar.
9. Docs: APP-SHELL, COPY-DECK tab labels, IMPL report.

### Should
- Active tab matches pathname (incl. `/markets`).
- Docs GitHub link: TopBar overflow or omit on phone (external; not a fourth product surface).
- `viewport-fit=cover` in metadata if safe-area is flaky — only if needed after visual check; don’t chase iOS 26 Liquid Glass edge cases in U5.

### Defer (U6 / later)
- PWA manifest / install prompt.
- Real device farm (BrowserStack).
- Swipe-to-close positions (HL pattern) — easy to break settle/burn.
- Native bottom-sheet physics / drag handles.
- Redesigning Markets content (thin page stays thin).

---

## 5. File hit list (expected)

- `components/shell/AppShell.tsx` — compose tab bar; padding math
- `components/shell/MobileTabBar.tsx` — **new**
- `components/shell/Sidenav.tsx` — `hidden md:flex` (or equivalent)
- `components/shell/PrototypeBanner.tsx` — maybe export stacked height helper; text wrap already allowed
- `components/shell/TopBar.tsx` — compact polish only if overflow
- `components/trade/TradePanel.tsx` / `IndexedCharts.tsx` — mobile disclosure around viz
- `components/primitives/RangeSlider.tsx` — larger touch handles <md
- `components/primitives/SlideOver.tsx` — z-index above tabs; bottom safe padding when open
- `e2e/shell.spec.ts` — tab bar + sidenav visibility by project
- Docs: `APP-SHELL.md`, `COPY-DECK.md`, `docs/audits/IMPL-UI-V2-U5-MOBILE-REPORT.md`

---

## 6. Acceptance checklist

- [ ] <768: bottom tabs Trade/Portfolio/Vault/Markets; no left letter-rail
- [ ] ≥768: sidenav as today; no bottom tabs
- [ ] Banner verbatim, always visible, not covered by tabs
- [ ] Trade phone: ticket first; market data collapsed by default
- [ ] Open SlideOver covers tab bar; Esc/focus trap still work
- [ ] 44px targets on tabs + primary buttons + range handles
- [ ] No horizontal overflow at 390×844; desktop desk regression-free
- [ ] Gates green; screenshots intentional
- [ ] No protocol / IDL / tx semantic changes

---

## 7. Forbidden

- Softening honesty banner; fake metrics; multi-leg; order books; APY
- Icon packs (Lucide etc.) — text labels only unless already present
- Glass / blur tab bars / soft shadows
- Breaking ≥1280 Trade desk grid or U1–U4 sheets
- PWA / native app scope creep

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Double chrome (rail + tabs) | Hide sidenav <md |
| Content hidden under tabs+banner | Single padding calc; e2e scroll last CTA into view |
| Sheet under tabs | SlideOver z > tab z; full viewport sheet |
| Desktop regression | CSS breakpoints only; e2e assert no tab bar on desktop project |
| Safe-area zero on some WebViews | padding env() with 0 fallback; banner already does this |

---

## 9. Sources (selected)

- In-repo: `PRODUCT-UI-V2-RESEARCH.md` §5, `UI-UPGRADE-RESEARCH.md` Phase 5, `COPY-DECK.md` §1, `UI-QA-CHECKLIST.md`, shell components, U0–U4 IMPL reports
- Hyperliquid mobile nav / collapsible panels — interface guides 2026; UX case study
- Aevo — mobile as secondary / ticket-oriented; native app exists but out of scope for PERMA U5
- iOS safe-area + fixed footers — `env(safe-area-inset-bottom)`, `viewport-fit=cover` guidance (apply conservatively)
