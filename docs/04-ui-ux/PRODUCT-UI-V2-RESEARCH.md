# PERMA Product UI V2 — Research Pack (Desktop + Mobile)

> **Scope:** Product app only (`Trade` / `Portfolio` / `Vault` / Markets). **Not** the marketing landing page (`MARKETING-SITE.md`).  
> **Date:** 2026-09-21  
> **Status:** Prototype. Not audited. Not production mainnet risk capital.  
> **Hard rule:** No fabricated charts, TVL, APY, depth, or unrealized P&L. Prefer empty/degraded states over lying UI.

---

## 1. Where PERMA UI is today (honest baseline)

| Layer | Today |
|---|---|
| Stack | Next.js 14, React 18, Tailwind 3, Zustand, Anchor + Solana wallet-adapter, Playwright e2e, Vitest |
| Routes | `/trade`, `/portfolio`, `/vault` (+ shell) |
| Design system | `docs/04-ui-ux/BRAND-SYSTEM.md` → `apps/web/src/styles/tokens.css` (“Institutional Precision”) |
| Primitives | Hand-built (Button, Table, DataTile, Toast…) — **not** default shadcn |
| Data | On-chain hooks (`useMarket`, `usePositions`, `useUserCollateral`…) + P2 indexer (Mac checkout; port 8799) |
| Charts | Thin / stub; docs forbid fake series (`INDEXER-AND-PRODUCT-UI.md`) |
| Mobile | Responsive shell (icon-rail sidenav < `md`); Playwright 390×844 green — **not** a full mobile trading desk yet |
| QA | `UI-QA-CHECKLIST.md` anti-slop signed with Playwright evidence |

**Gap vs business-grade peers:** density, payoff / range visualization, live chart panes wired to indexer, review-order modal, mobile progressive disclosure, loading/stale/error choreography, keyboard + touch polish.

---

## 2. Peer teardown (what “business grade” means here)

### 2.1 Panoptic (primary peer — perpetual options)

Sources: [Opening a Position](https://panoptic.xyz/docs/product/opening-a-position), [Position Management](https://panoptic.xyz/docs/product/position-management), [Option Legs](https://panoptic.xyz/docs/product/option-legs), [V2 yield platform](https://panoptic.xyz/blog/panoptic-v2-the-defi-yield-platform).

| Pattern | What traders see | PERMA V1 map |
|---|---|---|
| Market select + fee tier | Pair + Uniswap fee bps | Single Orca pool today; multi-pool = P6 |
| Collateral deposit first | Deposit before trade | Vault already exists — **elevate in Trade empty-state** |
| Strategy templates | 1-click bull/bear multi-leg | **Defer** until P5; Fair = single range leg |
| **Payoff / P&L curve** | Interactive chart; drag strike | **Adapt:** range band + streaming-premium in-range region (not fake Greeks) |
| Legs editor | +Leg, buy/sell, ratio | **Defer** to P5; show one “leg” = range + side |
| Review Position modal | Pair, strike, delta, max loss, BP | Build **Review mint** sheet with real Fair fields only |
| Positions dashboard | Cards/list, detail, streamia | Portfolio table → richer cards + settle/burn |
| Liquidity gate | “Insufficient liquidity at strike” | Map to inventory empty / size caps (already partially there) |
| Desktop-first | Docs: “currently built for desktop” | Match: **desktop desk first**, mobile second |

### 2.2 Aevo (options + perps polish)

Sources: Aevo reviews 2026 (TradingView charts, dense desktop, PWA mobile).

| Pattern | Take for PERMA |
|---|---|
| TradingView-class charts | Use **Lightweight Charts** (open TV library), not full TV widget license unless needed |
| Crowded laptop layouts | Use CSS grid with collapse breakpoints; don’t cram options-chain density PERMA doesn’t have |
| Mobile = check + simple ticket | Mobile: Portfolio + Vault + simplified Trade ticket; charts secondary |

### 2.3 Hyperliquid (CEX-like density)

Sources: [UX case study](https://bnsx3801.substack.com/p/hyperliquid-ux-case-study-research), live app chrome.

| Pattern | Take for PERMA |
|---|---|
| Chart | Order ticket | Positions strip | **Trade stage layout** template |
| Post-connect deposit prompt | After wallet connect → nudge Vault if collateral = 0 |
| Avoid cognitive overload | Progressive disclosure: Advanced (ticks, rent) behind disclosure |
| Live mark / funding strip | TopBar: spot (Orca), pause, free collateral |

### 2.4 Orca (Solana vernacular)

| Pattern | Take for PERMA |
|---|---|
| Pool / range mental model | Keep tick/range language; visualize as band on price axis |
| Wallet-adapter UX | Keep Phantom flow; polish modal + cluster guard |

### 2.5 What NOT to copy

- Fake order books / depth for a CLMM-options protocol.
- Unrealized P&L columns (APP-SHELL + ADR-0003: not on-chain for Fair).
- Multi-leg templates before P5.
- Liquidation health gauges before P4.
- Marketing gradients / glass / Inter-default “AI SaaS” look (already banned in BRAND-SYSTEM).
- Pixel-copying Panoptic (IP + honesty).

---

## 3. Target information architecture (product only)

```
AppShell
├── PrototypeBanner (keep)
├── Sidenav: Trade | Portfolio | Vault | Markets* 
├── TopBar: market | spot | pause | free USDC/SOL | Connect
└── Stage
    ├── Trade (desk)
    │   ├── ChartPane (premium series + range band) — real data only
    │   ├── InventoryStrip (shorts available by range)
    │   ├── TradeTicket (side, range, size, preview)
    │   └── ReviewSheet (confirm mint)
    ├── Portfolio
    │   ├── Positions (table desktop / cards mobile)
    │   ├── PositionDetail (slide-over)
    │   └── History* (indexer)
    └── Vault
        ├── CollateralSummary
        ├── Deposit / Withdraw
        └── Solvency / required free USDC
```

\* Markets list can be a thin page even with one pool (pause + inventory summary).

---

## 4. Charting decision

| Option | Verdict |
|---|---|
| **TradingView Lightweight Charts v5** | **Choose.** Small, canvas, React-friendly, realtime `series.update`, free. Official [React tutorials](https://tradingview.github.io/lightweight-charts/tutorials/react/advanced). Agent skill: `npx skills add https://github.com/tradingview/lightweight-charts --skill …` (repo ships AI skill). |
| Full TradingView widget | Skip for V1 (license + iframe control). |
| Recharts / Chart.js | OK for simple admin; wrong density for trading desk. |
| Fabricated SVG “demo” charts | **Forbidden.** |

**Allowed series (with indexer):** premium index over time; inventory by range; user premium history.  
**Forbidden:** random walks, fake depth, pre-P4 liq distance.

Client-only chart wrapper (`next/dynamic` ssr:false), ResizeObserver, theme from CSS tokens, hide pane if `/premium/series` empty or indexer unhealthy.

---

## 5. Desktop vs mobile strategy

| Viewport | Layout |
|---|---|
| ≥1280px | Full desk: chart (flex 1) + ticket (~360–400px) + optional bottom positions strip |
| 768–1279 | Chart above ticket stacked; sidenav icon rail |
| <768 | **Mobile product mode:** bottom tab bar (Trade / Portfolio / Vault); Trade = ticket-first; Chart behind “Chart” tab or accordion; 44px touch targets; no tiny dual tick sliders without large handles |

PWA optional later; responsive web first (Aevo pattern). Native app = out of scope.

---

## 6. Claude Code skill stack (required for this work)

### 6.1 Install (run in terminal Claude Code)

```bash
# 1) Official anti-slop / distinctive UI (auto-loads on frontend tasks)
/plugin install frontend-design@claude-plugins-official

# 2) Vercel quality stack (a11y + React/Next perf + composition)
npx skills add vercel-labs/agent-skills \
  --skill web-design-guidelines \
  --skill react-best-practices \
  --skill composition-patterns \
  -a claude-code -y

# 3) Lightweight Charts agent skill (chart API footguns)
npx skills add https://github.com/tradingview/lightweight-charts -a claude-code -y
# If the CLI asks for a skill name, pick the charts / agent skill the repo exposes.

# 4) Optional polish loop (multi-persona critique) — install when doing visual redesign passes
# /plugin marketplace add andrejkanuch/design-lenses
# /plugin install design-lenses@…
```

### 6.2 Already installed (use carefully)

| Plugin | UI V2 use |
|---|---|
| **frontend-design** | **ON** for layout/visual passes |
| **caveman** | Optional for long Rust-style prompts; **OFF** when writing UI copy (needs full sentences) |
| **ponytail** | **OFF** for UI polish (minimizes code; fights density) |
| **Graphify** | Optional architecture map of `apps/web` once |
| **headroom** | Optional token compression on huge prompts |

### 6.3 Project skills to add (PERMA-specific)

Create under `.claude/skills/` (or docs prompts Claude must read):

1. `perma-brand-lock` — must follow `BRAND-SYSTEM.md` + `tokens.css`; ban glass/gradients/shadows/>8px radius; no Inter-as-hero; tabular-nums on live metrics.
2. `perma-honesty` — no fake charts/TVL/APY/unrealized P&L; empty > lie; keep Prototype banner.
3. `perma-no-break` — do not change `programs/`; do not reshape IDL; keep hooks/tx paths; e2e + typecheck + check-copy green.
4. `perma-fair-surface` — only Fair+P1+P2 capabilities in UI; stub labels for P4/P5 forbidden.

### 6.4 Model guidance

- Visual redesign + charts: **Opus** (or strongest available).
- Mechanical wiring / tests: Sonnet OK after design tokens locked.

---

## 7. Phased implementation (nothing breaks)

Each phase: branch work in `apps/web` only (+ docs). Gate: `yarn typecheck && yarn test && yarn check-copy && yarn test:e2e` (+ build).

| Phase | Name | Deliverable | Forbidden |
|---|---|---|---|
| **U0** | Foundation | Token audit, AppShell density, TopBar metrics, loading/skeleton/stale primitives, focus rings | New routes that bypass shell; brand drift |
| **U1** | Trade desk | CSS grid desk layout; ticket polish; ReviewSheet; empty→Vault CTA | Fake payoff Greeks; multi-leg |
| **U2** | Charts (real) | Lightweight Charts + indexer `/premium/series` + range band overlay; degraded empty | Placeholder series |
| **U3** | Portfolio | Cards/table, slide-over detail, history from indexer if API live | Unrealized P&L column |
| **U4** | Vault | Institutional deposit/withdraw choreography; post-connect collateral nudge | Softening insolvency gates |
| **U5** | Mobile | Bottom tabs, touch targets, ticket-first Trade | Breaking desktop desk |
| **U6** | Harden | web-design-guidelines audit, react-best-practices, perf (dynamic import charts), a11y pass | Drive-by protocol changes |

---

## 8. Success criteria (business-grade)

- Looks like a **trading product**, not a hackathon demo or marketing template.
- Every number is live (RPC and/or indexer) or explicitly “—” / “Indexer unavailable”.
- Desktop 1440×900 and mobile 390×844 Playwright visual + interaction green.
- Matches BRAND-SYSTEM + UI-QA rejection criteria (no AI slop).
- Mint / deposit / withdraw / settle / burn paths unchanged in semantics.
- Honesty banner remains.

---

## 9. Sources (selected)

- Panoptic product docs (opening / legs / management) — panoptic.xyz/docs/product/*
- Anthropic `frontend-design` skill — github.com/anthropics/claude-code/plugins/frontend-design
- Vercel agent-skills (`web-design-guidelines`, `react-best-practices`, `composition-patterns`)
- TradingView Lightweight Charts — github.com/tradingview/lightweight-charts
- Hyperliquid UX case study — bnsx3801.substack.com
- PERMA in-repo: `docs/04-ui-ux/*`, `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`

