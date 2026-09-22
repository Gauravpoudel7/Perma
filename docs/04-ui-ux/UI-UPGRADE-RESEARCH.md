# PERMA Product UI Upgrade Research
**Audience:** CLAUDE-IMPLEMENT-UI prompt authors + implementers  
**Scope:** Product app only (Trade / Portfolio / Vault) — **not** marketing landing  
**Date:** 2026-09-21 (Asia/Kathmandu)  
**Honesty baseline:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

---

## 0. Ground truth — what PERMA Fair actually has

Do **not** invent features. Sources: repo `docs/00-overview/MVP-SCOPE.md`, `docs/04-ui-ux/*` (APP-SHELL, BRAND-SYSTEM, COMPONENT-LIBRARY, COPY-DECK), `apps/web`, `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`.

| Capability | Fair / today | Deferred |
|---|---|---|
| Deposit / withdraw USDC + SOL collateral | Yes (Vault) | — |
| Open **1-leg** Short (range → real Orca Whirlpool liquidity CPI) | Yes (Trade) | Multi-leg (spreads/straddles/condors) |
| Open **1-leg** Long (inventory-gated against shorts in range) | Yes (Trade) | Multi-pool / permissionless markets |
| Portfolio positions + Close/Settle (burn) | Yes | Unrealized mark PnL column (forbidden under ADR-0003 Fair risk model) |
| Streaming premium index (on-chain) | Yes (hook/RPC) | Rich historical series UI until indexer series is real |
| Pause / market status + honesty banner | Yes | Remove banner only under audited mainnet policy |
| Inventory empty / insufficient liquidity states | Yes | Fake order-book “depth” |
| Solvency as **required free USDC** amount | Yes | Solvency **ratio %** / liquidation distance gauge |
| Indexer HTTP (~`:8799`) markets / positions / premium series | P2 surface (prefer real data or hide) | Synthetic charts if down |
| Liquidation health / force exercise | No | Post P3/P4 protocol work |
| Greeks board / options chain / RFQ | No | Not Fair; Derive/Aevo-class |

**Hard no-break invariants for any UI upgrade**

- Keep existing hooks, tx builders, IDL, wallet-adapter paths.
- Keep `PrototypeBanner` exact copy (e2e asserts it).
- Keep `check-copy` / banned-phrase gate green.
- Keep Playwright e2e + vitest green.
- Prefer **hidden chart** over **lying chart** when indexer lagging.

---

## 1. Competitive UI teardown

### 1.1 Panoptic (primary peer — perpetual options on Uniswap V3)

**Sources**

- https://panoptic.xyz/docs/product/opening-a-position  
- https://panoptic.xyz/docs/product/position-management  
- https://panoptic.xyz/blog/demoing-panoptic-defi-options-protocol  
- https://panoptic.xyz/blog/panoptic-prime-beta-v2  

**Screen inventory / IA**

| Screen | Role |
|---|---|
| Connect wallet | Desktop-first; wallet top-right |
| Market select | Pair + Uniswap fee tier |
| Collateral deposit / onboarding | Deposit either asset of pair before trade |
| Strategy templates | Bullish/bearish presets (call/put, spreads…) |
| Trade / legs builder | Payoff curve first; editable legs; drag strike on chart |
| Review position | Pair, strike, fee, delta, max loss, buying power, legs |
| Dashboard / Positions | Grid or list cards; Close CTA |
| Position details | PnL %, premia tabs, range/streamia, spread multiplier, leg meta |

**Components / patterns to study**

- Payoff curve with red/green zones as primary mental model.
- Streamia range markers (dots left/right of strike) = “premium accrues only in-range.”
- Buying-power % sizing (5% / … of available power).
- Liquidity toggle / “insufficient liquidity at strike” hard block.
- Review modal before chain submit (slippage + spread tolerance).
- Position cards: mint price, current price, accumulated premia, requirement, tx hash.
- Desktop-first (docs explicitly: “currently built for desktop”).

**Responsive / motion / typography / density**

- Dense desktop trading desk; mobile secondary.
- Calm financial UI; color = P&L / in-range status, not marketing gradients.
- High information density on position details; progressive disclosure via card → detail.

**Adopt NOW (Fair-compatible)**

- Trade desk: range visualization + “premium accrues in-range” callouts (map to PERMA tick lower/upper).
- Review/confirm strip before submit (no new protocol — UX only).
- Inventory/liquidity empty states as first-class (already partially present).
- Position table density + explorer link / mint slot meta.
- Desktop-first layout with later mobile collapse.

**Adopt AFTER P4/P5 (or never invent in Fair UI)**

- Multi-leg builder, strategy templates (iron condor etc.) — needs multi-leg protocol.
- Buying-power leverage % metaphors that imply price-aware margin PERMA Fair lacks.
- Liquidation / buying-power-usage gauges — needs P4.
- Streamia “spread multiplier ν” UI — only if PERMA exposes equivalent on-chain.

---

### 1.2 Aevo (CEX-like options + perps)

**Sources**

- https://insidecryptoreview.com/en/dex/aevo  
- https://decentralised.news/aevo-review-2026-on-chain-options-perpetuals-exchange  
- https://www.cryptowinrate.com/aevo-exchange-review  
- https://www.aevo.xyz/docs/aevo-products/aevo-perps+/walkthrough.md  
- https://apps.apple.com/gb/app/aevo/id6761087040  

**Screen inventory / IA**

- Unified account: Perps ↔ Options tabs.
- Trade: TradingView chart | order book | order ticket.
- Options chain: strikes × expiries, Greeks, IV surface.
- Portfolio: positions, margin, unrealized PnL, liquidation price.
- Mobile: native app / PWA for monitor + trade; chain density still desktop-biased.
- PERPS+ enhancers (options bolted onto perps) — irrelevant to PERMA Fair.

**Patterns**

- Panelized CEX terminal (chart / book / form / bottom positions).
- Visual flash on book fills; many order types (limit/stop/TWAP/scale).
- Professional, not “DeFi playful.”

**Adopt NOW**

- Panel grid density language (chart | ticket | context) **without** inventing an order book.
- Bottom positions strip on Trade (deep-link to Portfolio actions).
- Tabular nums, muted chrome, high-contrast CTAs.

**Defer / do not fake**

- Order book, Greeks chain, IV surface, liquidation price, multi-leg enhancers.

---

### 1.3 Derive / Lyra (options chain + retail clarity)

**Sources**

- https://insights.derive.xyz/01-how-to-read-the-derive-options-chain/  
- https://blog.lyra.finance/avalon-is-live/  
- https://insights.derive.xyz/avalon-is-live/  
- https://www.danajwright.com/the-evolution-of-lyra-finance  
- https://www.bankless.com/a-guide-to-options-on-lyra  

**Screen inventory / IA**

- Trade: market → expiry → call/put → strike board → ticket + payoff.
- Portfolio: open/expired, balances, history, performance time series (Avalon).
- Vaults: automated yield strategies (separate surface).
- Mobile-first Avalon redesign + global side nav.

**Patterns**

- Options chain density (bid/mark/ask, delta, IV) for listed expiries.
- Payoff chart adjacent to ticket.
- Portfolio as control center (traders + LPs).
- Soften complexity for retail without removing power-user columns.

**Adopt NOW**

- Side-nav + Portfolio-as-control-center (PERMA already close).
- Payoff / range diagram next to ticket (1-leg only).
- Clear Long vs Short / Call-like framing **only if** copy stays honest to range-option mechanics (do not pretends listed strikes+expiries).

**Defer**

- Full chain UI, expiries, RFQ, vault yield products, portfolio mark performance that contradicts ADR-0003.

---

### 1.4 Hyperliquid (CEX-like density reference — not options peer)

**Sources**

- https://perpdexguide.com/hyperliquid/trading-interface/  
- https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/  
- https://onekey.so/blog/ecosystem/hyperliquid-orderbook-reading/  

**Layout regions (steal structure, not product)**

1. Market header (mark/oracle analogues → for PERMA: spot tick, pause, premium index).  
2. Chart center.  
3. Right order ticket.  
4. Bottom positions/history strip.  

**Patterns**

- Restraint: few modules, no campaign chrome.
- Dense but scannable monospace numbers.
- Mobile usable but degraded vs desktop.

**Adopt NOW**

- Four-region Trade desk mapping: Header | Chart/Range viz | Ticket | Bottom positions.
- Reduce marketing/noise; maximize execution path.
- Layout toggle later (hide secondary panels) — optional Phase 5+.

**Do not adopt**

- Order book, chase/scale/TWAP order types, funding countdown — wrong product model.

---

### 1.5 Orca (Solana vernacular — Whirlpools / Liquidity Terminal)

**Sources**

- https://blog.orca.so/the-only-lp-terminal-you-need-on-solana-a-complete-guide-to-orcas-liquidity-terminal/  
- https://solstice.finance/blog/chris-weekly-thread-orca-ux  
- https://www.dextools.io/tutorials/how-to-use-orca-dex-solana-swap-liquidity-tutorial-2026  

**Screen inventory / IA**

- Swap (clean Pay/Receive) vs Liquidity Terminal (LP power tools).
- Terminal: historic price, liquidity distribution, position simulator, range presets, live range overlay, out-of-range alerts, history, live PnL.
- Mobile-first LP management; large tap targets.

**Patterns (critical for PERMA)**

- Range presets as strategy entry points.
- Price chart with **range bounds overlay** (exact Short/Long mental model).
- Liquidity distribution histogram by price (honest inventory viz).
- Progressive disclosure; fair-price / impact warnings.
- Solana wallet vernacular (Phantom/Solflare/Backpack patterns).

**Adopt NOW**

- Range presets (e.g. ±1% / ±5% / custom ticks) on Trade.
- Inventory-by-range histogram from real short inventory (indexer or account aggregation) — label as **inventory**, never “order book depth.”
- Spot + range overlay on chart.
- Mobile: stack ticket under viz; enlarge sliders/CTAs.

**Defer**

- Out-of-range push notifications / Telegram — post product polish.
- LP vs Hold simulator with fabricated returns.

---

## 2. Peer pattern → PERMA Fair capability map

| Peer pattern | PERMA Fair mapping | Status |
|---|---|---|
| Panoptic payoff + drag strike | Dual tick range slider + payoff sketch for 1-leg long/short | **NOW** (UI); drag optional |
| Panoptic streamia in-range dots | Badge: “Premium streams while spot in [lo, hi]” | **NOW** |
| Panoptic multi-leg / templates | — | **AFTER multi-leg protocol** |
| Panoptic buying power % | Size as USDC/SOL + collateral required preview (existing) | **NOW**; avoid fake leverage % |
| Panoptic liquidation usage bar | — | **AFTER P4** |
| Aevo/HL chart+ticket+bottom strip | Trade desk grid | **NOW** |
| Aevo order book / Greeks | — | **Never fake** |
| Derive options chain | — | **Deferred**; Fair is range mint not listed chain |
| Derive portfolio control center | Portfolio page enrichment | **NOW** (no mark PnL %) |
| Orca range overlay + presets | Trade range UX | **NOW** |
| Orca liquidity distribution | Inventory histogram | **NOW** if data real; else hide |
| HL density / restraint | Visual system | **NOW** |
| Vault yield products (Derive/Panoptic V2) | PERMA Vault = collateral only | **Do not rename to “Earn APY”** |

---

## 3. Claude Code skill stack (production UI)

### 3.1 Exact install commands (verified)

Run inside Claude Code / project root as appropriate.

```bash
# 1) Anthropic official Frontend Design plugin (distinctive non-slop UI)
# In Claude Code chat (official marketplace auto-registered):
/plugin install frontend-design@claude-plugins-official
# If marketplace missing:
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/reload-plugins

# 2) Vercel agent-skills (web-design-guidelines + react-best-practices + composition-patterns)
npx skills add vercel-labs/agent-skills
# Optional: pin skills explicitly
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
npx skills add vercel-labs/agent-skills --skill react-best-practices
npx skills add vercel-labs/agent-skills --skill composition-patterns

# 3) AccessLint a11y skills (WCAG scan / inspect / audit / fix / diff) — verified
npx skills add AccessLint/skills
# Claude Code plugin form:
claude plugin marketplace add accesslint/skills
claude plugin install accesslint@accesslint

# 4) Impeccable (design skill + anti-slop detectors) — verified https://impeccable.style
npx impeccable install
# then in agent:
/impeccable init
# Optional Claude marketplace (repo: pbakaus/impeccable):
/plugin marketplace add pbakaus/impeccable

# 5) Design Lens (reference-driven UI) — verified https://github.com/mojomoth/design-lens
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
# or: npx skills add mojomoth/design-lens

# 6) Caveman (terse agent prose; optional proxy) — verified https://github.com/JuliusBrussee/caveman
npx skills add JuliusBrussee/caveman -g
# Claude plugin alternate:
claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman

# 7) Ponytail (minimal necessary code ladder) — verified https://github.com/DietrichGebert/ponytail
# TWO separate Claude Code prompts required:
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
# Levels: /ponytail lite|full|ultra|off  — default full

# 8) Headroom (local context/token proxy — NOT a design skill)
# https://github.com/headroomlabs-ai/headroom  https://docs.headroomlabs.ai
uv tool install --python 3.13 "headroom-ai[all]"
headroom wrap claude
# Prefer PERMA indexer on :8799; Headroom commonly binds :8787 — do not collide
```

**Sources**

- https://code.claude.com/docs/en/plugins.md  
- https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design  
- https://github.com/vercel-labs/agent-skills  
- https://github.com/AccessLint/skills  
- https://impeccable.style/tutorials/getting-started  
- https://github.com/pbakaus/impeccable  
- https://github.com/mojomoth/design-lens  
- https://github.com/JuliusBrussee/caveman  
- https://github.com/DietrichGebert/ponytail  
- https://github.com/headroomlabs-ai/headroom  

### 3.2 When to use which (conflict resolution)

| Tool | Shrinks / steers | Use for PERMA UI | Conflict |
|---|---|---|---|
| **frontend-design** + **Impeccable** | Visual quality, anti-slop, hierarchy | Phase 0–3 visual system, Trade desk chrome | Can push “richer” UI |
| **vercel web-design-guidelines** | a11y/UX audit checklist | Phase 6 + every PR review | None |
| **vercel react-best-practices** | Perf / RSC / waterfalls | Chart wiring, polling, bundle | None |
| **composition-patterns** | Compound components | TradePanel / DataTile refactors | Mild vs ponytail |
| **AccessLint** | WCAG evidence | Phase 6 | None |
| **design-lens** | Peer screenshot → structure | Phase 1 layout teardown sessions | Don’t pixel-copy Panoptic |
| **Caveman** | Agent **prose** tokens | Always-on OK during impl | Doesn’t shrink code |
| **Ponytail** | Agent **code** volume (YAGNI ladder) | Bugfixes, hooks, tx paths, tests | **Conflicts with design-skill richness** |
| **Headroom** | Context compression proxy | Long research/impl sessions | Port clash vs indexer |

**Recommended policy**

1. **UI visual phases (0–3, 5):** enable `frontend-design` + Impeccable; set **`/ponytail off`** (or `lite` only). Design skills win.  
2. **Protocol/tx/hook/IDL work:** `/ponytail full` or `ultra`; keep design skills from “restyling everything.”  
3. **Caveman:** OK alongside both (mouth smaller, code unchanged).  
4. **Ponytail + Impeccable together:** allow only if prompt says “minimal DOM that still meets DESIGN.md” — otherwise ponytail will strip density PERMA needs.  
5. **Headroom:** optional infra; document `INDEXER_PORT=8799` vs Headroom `8787`.

---

## 4. Anti-slop + trading-desk aesthetic direction

Align with existing `docs/04-ui-ux/BRAND-SYSTEM.md` (Institutional Precision). Product UI ≠ landing.

### Do

- Deep black `#0A0A0A` / surface `#141414` / border `#262626`; 1px borders, **no** glass/blur.
- Inter/Geist product sans; Geist Mono / JetBrains Mono for ticks, sizes, signatures; `tabular-nums` everywhere live.
- White primary CTA; danger only for Close/Withdraw.
- Density: 12–14px body, tight table rows, overline caps for column headers.
- Motion: ≤150ms opacity/translate; honor `prefers-reduced-motion`; no bounce/particles.
- Semantic green/red **only** for premium earned/owed and pause/error — not decorative.
- Empty/stale/indexer-lag states that tell the truth.

### Don’t (anti-slop)

- Purple/blue AI gradients, neon Solana-everywhere, glassmorphism, soft multi-shadow cards.
- Floating marketing blobs, emoji-as-UI, “gamified” confetti on mint.
- Fake TVL/APY tiles, fake depth, fake unrealized PnL %.
- Card-in-card nesting, Inter-everywhere hero mush, rounded-2xl consumer SaaS chrome.
- Serif in tables/forms (serif = marketing only per brand).

### Desk metaphor (target)

Hyperliquid restraint + Orca range tools + Panoptic options honesty — on Solana wallet chrome. Think **Coinbase Institutional / Linear density**, not Stripe marketing.

---

## 5. Phased implementation plan (never break)

**Global gates each phase:** `yarn`/`pnpm` typecheck + vitest + Playwright e2e + `check-copy` green; no IDL/tx path edits unless bugfix; banner text unchanged.

### Phase 0 — Design tokens / shell
- Codify tokens in CSS vars / Tailwind theme from BRAND-SYSTEM (already partial).
- AppShell: sidenav width, top bar metrics cluster (spot, premium index, pause), banner safe-area.
- Primitive pass: Button, DataTile, Table, Toast — visual only.
- **No** chart library yet.

### Phase 1 — Trade desk layout
- CSS grid: `header | rangeViz | ticket | optionalInventory | bottomPositions`.
- Range presets + clearer collateral/premium preview.
- Review/confirm summary row before `Open`.
- Wire existing hooks only (`useMarket`, `usePremiumIndex`, `usePositions`, etc.).

### Phase 2 — Portfolio
- Denser PositionsTable; explorer links; premium owed/earned clarity.
- History section **only** if indexer `/positions/{owner}/history` returns real rows; else CTA “history when indexer synced.”
- **Forbidden:** unrealized PnL %, solvency ratio %.

### Phase 3 — Vault
- Deposit/Withdraw forms polish; required-free-USDC tile hierarchy.
- Insolvent withdrawal block UX (already gated) — clearer explanation copy from COPY-DECK.
- No APY / “earn” repositioning.

### Phase 4 — Charts ↔ indexer (`:8799`)
- Client-only chart host; fetch `/premium/series`, inventory buckets, health.
- If `/health` lagging or series empty → **hide** chart + “Indexer degraded” note.
- RPC-verify balances before risk-increasing actions (existing rule).

### Phase 5 — Mobile
- Breakpoints: sidenav → bottom tabs or drawer; stack viz above ticket; 44px targets.
- No feature removal; progressive disclosure for advanced ticks.

### Phase 6 — a11y / perf polish
- AccessLint scan + keyboard e2e expansion; focus rings; contrast.
- React best-practices: chart code-split, poll backoff, avoid rerender waterfalls.
- Impeccable `audit` / `polish` on Trade/Portfolio/Vault only.

---

## 6. Chart library recommendation

| Library | Fit for PERMA | Pros | Cons |
|---|---|---|---|
| **lightweight-charts** (TradingView OSS) | **Primary recommendation** | Canvas, realtime `series.update`, small bundle, Apache-2.0, candlesticks + area + histogram; custom overlays for range bands | Need `dynamic(..., { ssr: false })` in Next.js; draw range lines via primitives/plugins |
| TradingView Advanced Charts **widget** | Not recommended now | Full trader chrome, drawings, indicators | License/commercial terms; heavy; hard to overlay PERMA inventory honestly; overkill for premium index |
| **recharts** | Secondary only | Easy React SVG for simple portfolio/premium sparkline | Weak for HFT-style streams & candles; SVG cost |

**Decision:** use **`lightweight-charts`** for Phase 4 premium index + inventory histogram; optional **recharts** only for tiny Vault sparklines if any. Do **not** embed TradingView symbol widget for SOL-PERMA (no listed TV symbol; custom protocol series).

**Next.js pattern**

```ts
// ChartHost.tsx — client only
import dynamic from "next/dynamic";
const PremiumChart = dynamic(() => import("./PremiumChart"), { ssr: false });
```

**Sources**

- https://tradingview.github.io/lightweight-charts/docs  
- https://www.npmjs.com/package/lightweight-charts  
- https://github.com/tradingview/lightweight-charts/blob/master/LICENSE  

---

## 7. Paste-ready sections for `CLAUDE-IMPLEMENT-UI`

### 7.1 Mission

```text
Upgrade PERMA product UI (Trade / Portfolio / Vault only — NOT marketing)
to business-grade desktop+mobile. Stack: Next.js 14, React 18, Tailwind,
Zustand, Anchor/wallet-adapter, Playwright, vitest. Protocol is paused at
Fair+P1+P2 for UI focus. Indexer prefer :8799. Charts only from real indexer
data; hide if empty/stale. Keep hooks, tx paths, IDL, honesty banner,
check-copy, e2e green. Do not invent multi-leg, liquidation gauges,
Greeks, order books, unrealized PnL %, or solvency ratio %.
```

### 7.2 Non-negotiables

```text
- Banner exact: "Prototype. Not audited. Single pool. Not production mainnet risk capital."
- 1-leg only; single allowlisted SOL/USDC Whirlpool market
- Vault = collateral deposit/withdraw; not yield vault APY
- Portfolio: no unrealized PnL column; no solvency %
- Inventory viz labeled inventory/liquidity available — never "order book"
- Prefer hidden chart over fabricated series
```

### 7.3 Phase checklist (implement one phase per PR)

```text
[ ] P0 tokens/shell
[ ] P1 Trade desk grid + presets + confirm strip
[ ] P2 Portfolio density + honest history
[ ] P3 Vault hierarchy
[ ] P4 lightweight-charts + indexer wiring + degraded states
[ ] P5 mobile IA
[ ] P6 a11y/perf (AccessLint + vitest/e2e)
```

### 7.4 Skill runtime for implementer

```text
Enable: frontend-design@claude-plugins-official, vercel-labs/agent-skills
       (web-design-guidelines, react-best-practices, composition-patterns),
       AccessLint, impeccable (init against PRODUCT/DESIGN).
Disable or /ponytail off during visual phases.
Caveman optional for prose.
design-lens allowed for structure reference from Panoptic/Orca — no pixel copy.
```

### 7.5 Acceptance tests

```text
- Playwright: banner, shell nav Trade/Portfolio/Vault, keyboard paths still pass
- vitest unit green; check-copy zero hits
- Manual: pause banner, inventory empty long path, withdraw insolvency block
- Charts: with indexer down, no placeholder series rendered
- Lighthouse/a11y: no critical contrast/focus regressions on Trade
```

---

## 8. Source index (URLs)

| Topic | URL |
|---|---|
| Panoptic open position | https://panoptic.xyz/docs/product/opening-a-position |
| Panoptic position mgmt | https://panoptic.xyz/docs/product/position-management |
| Panoptic demo UI | https://panoptic.xyz/blog/demoing-panoptic-defi-options-protocol |
| Panoptic V2 beta | https://panoptic.xyz/blog/panoptic-prime-beta-v2 |
| Aevo review UI | https://insidecryptoreview.com/en/dex/aevo |
| Aevo PERPS+ | https://www.aevo.xyz/docs/aevo-products/aevo-perps+/walkthrough.md |
| Derive options chain | https://insights.derive.xyz/01-how-to-read-the-derive-options-chain/ |
| Lyra Avalon UI | https://blog.lyra.finance/avalon-is-live/ |
| Lyra design case | https://www.danajwright.com/the-evolution-of-lyra-finance |
| Hyperliquid UI explainer | https://perpdexguide.com/hyperliquid/trading-interface/ |
| Hyperliquid vs CEX UX | https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/ |
| Orca Liquidity Terminal | https://blog.orca.so/the-only-lp-terminal-you-need-on-solana-a-complete-guide-to-orcas-liquidity-terminal/ |
| Orca UX notes | https://solstice.finance/blog/chris-weekly-thread-orca-ux |
| Claude plugins | https://code.claude.com/docs/en/plugins.md |
| frontend-design plugin | https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design |
| Vercel agent-skills | https://github.com/vercel-labs/agent-skills |
| AccessLint skills | https://github.com/AccessLint/skills |
| Impeccable | https://impeccable.style / https://github.com/pbakaus/impeccable |
| Design Lens | https://github.com/mojomoth/design-lens |
| Caveman | https://github.com/JuliusBrussee/caveman |
| Ponytail | https://github.com/DietrichGebert/ponytail |
| Headroom | https://github.com/headroomlabs-ai/headroom |
| lightweight-charts docs | https://tradingview.github.io/lightweight-charts/docs |
| PERMA in-repo (local) | `docs/00-overview/MVP-SCOPE.md`, `docs/04-ui-ux/APP-SHELL.md` + `BRAND-SYSTEM.md`, `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md` |

---

**End of report.** Ready to paste into `CLAUDE-IMPLEMENT-UI`.
