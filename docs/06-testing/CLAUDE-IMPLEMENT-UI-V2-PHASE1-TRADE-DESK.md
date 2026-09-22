# CLAUDE-IMPLEMENT-UI-V2 — Phase U1 Trade desk

> **Product UI only** (Trade / Portfolio / Vault). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (§3 Trade desk, §7 U1), `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md`, `COPY-DECK.md` §4.1, U0 report `docs/audits/IMPL-UI-V2-U0-FOUNDATION-REPORT.md`, and skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman for this session.  
> **Model:** strongest available for visual work (Opus).

## Goal

Turn `/trade` from a narrow centered form into a **business-grade trading desk** layout: chart/inventory pane + dense ticket + review-before-mint — without changing mint semantics, without fabricating payoff/Greeks, and without installing Lightweight Charts (that is **U2**).

U0 already shipped shell density, States primitives, TopBar Spot/Free, `collateralLoaded`, and `CollateralNudge`. Build on those; do not regress them.

## Current surface (evolve, don't greenfield)

| Piece | Path | Notes |
|---|---|---|
| Page | `apps/web/src/app/trade/page.tsx` | Wallet gate only; keep |
| Panel | `components/trade/TradePanel.tsx` | Today: `max-w-xl` stack; charts below ticket |
| Ticket fields | `SideToggle`, `RangeInput`, `SizeInput`, `PremiumPreview`, `TickArrayRentNotice`, `MarketHeader` | Keep hooks/stores |
| CTA | `OpenPositionButton.tsx` | Currently mints on click — wrap with ReviewSheet |
| Charts (stub) | `IndexedCharts.tsx` | Honest SVG from indexer; **keep for U1**; U2 replaces |
| Nudge | `CollateralNudge.tsx` | Keep; place in ticket column |
| States | `primitives/States.tsx` | Reuse Skeleton / Empty / Degraded / InlineError |
| Form store | `store/useTradeFormStore` | Keep |

## In scope

1. **Trade desk CSS grid** in `TradePanel` (and page if needed):
   - **≥1280px:** two-column desk — left flex pane (chart + inventory strip), right ticket column **~360–400px** fixed-ish. Optional thin **open positions strip** under the grid (read-only list linking to Portfolio; no unrealized P&L). Prototype banner + TopBar unchanged.
   - **768–1279:** stack — chart/inventory above ticket; sidenav icon rail already from U0.
   - **<768:** ticket-first is fine for U1 (U5 owns bottom tabs). Do not break mobile overflow (U0 fixed TopBar at 390px — preserve).
   - Drop the form-only `mx-auto max-w-xl` constraint on desktop so the stage uses the shell width.

2. **Chart / inventory pane (slot only — no new chart lib):**
   - Move `IndexedCharts` into the left pane (not buried under a narrow column).
   - Add an **InventoryStrip** (or elevate existing inventory empty/available readout): available short liquidity for the selected range, labeled **inventory / available liquidity** — never "order book" / "depth".
   - If indexer series empty or unhealthy: reuse `DegradedState` / hide chart (existing IndexedCharts rules). No placeholder fake series.

3. **Ticket polish (Fair 1-leg only):**
   - Dense vertical ticket: MarketHeader → SideToggle → RangeInput (keep tick snap + rent notice) → SizeInput → PremiumPreview → collateral impact / disabled reason → primary CTA.
   - Live numbers: `text-mono-* tabular-nums`.
   - Advanced (exact ticks, rent) may sit behind a disclosure if it reduces clutter — do not hide required rent/solvency blockers.
   - Optional **range presets** (e.g. around spot by N tick spacings) only if they call existing range setters and stay on-spacing; no fake “ATM / ITM” options language.

4. **ReviewSheet (new) — confirm before mint:**
   - Primary button opens a review surface (slide-over or modal using brand radius ≤8px, 1px border, no glass). Prefer slide-over / panel if primitives already lean that way; modal OK if consistent with Toast/Button.
   - Show **only real Fair fields:** market label, side (Short/Long), realized range (price + ticks if already shown), size/liquidity, Est. premium/hour when long + size set, tick-array rent notice when applicable, free USDC / collateral gate copy when that blocks longs.
   - Actions: **Cancel** / **Confirm Open Short|Long** (Confirm still runs existing `handleOpen` / `useSendPermaTx` path).
   - Do **not** show: Greeks, delta, max loss %, unrealized P&L, multi-leg, liquidation distance, depth.
   - Keyboard: Esc closes; focus trap; focus return to CTA. 44px touch targets on mobile.
   - Add COPY-DECK §4.1 rows for Review title / Confirm / Cancel if missing; keep `check-copy` green.

5. **Empty / inventory choreography:**
   - Keep `CollateralNudge` at top of ticket when zero collateral.
   - Long + no inventory: keep / wire `InventoryEmptyState` copy; disable Confirm with existing reasons.
   - Disconnected: keep page-level "Connect a wallet…" (or promote into EmptyState for consistency — optional).

6. **Docs:** Update `APP-SHELL.md` Trade Stage section for the desk grid + ReviewSheet. Short IMPL report (path below).

## Out of scope / Forbidden

- `programs/**`, IDL, new Anchor instructions, reshaping mint/deposit/withdraw/settle/burn semantics.
- Installing **lightweight-charts** or any chart library (**U2**).
- Fabricated payoff curves, Greeks, multi-leg templates (P5), liquidation gauges (P4), order books, unrealized P&L, TVL/APY.
- Marketing / landing pages; brand drift (glass, gradients, soft shadows, radius > 8px, raw hex, off-token spacing).
- Weakening OpenPositionButton guards (`canMintLong`, inventory caps, pause, wallet guard).
- Portfolio / Vault redesign (**U3 / U4**); bottom tab bar (**U5**).

## Acceptance

- [ ] Desktop ≥1280: visible desk — left viz pane + ~360–400px ticket; not a lone `max-w-xl` card.
- [ ] ReviewSheet appears before wallet popup; Cancel aborts; Confirm uses existing mint path.
- [ ] No forbidden metrics; inventory never labeled as order book; Prototype banner intact.
- [ ] U0 primitives preserved (`CollateralNudge`, TopBar Spot/Free, States).
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green in `apps/web`.
- [ ] Playwright 1440×900 and 390×844: no horizontal overflow; update screenshots only if intentional.
- [ ] Report: `docs/audits/IMPL-UI-V2-U1-TRADE-DESK-REPORT.md`.

## Method

1. Read TradePanel + OpenPositionButton + IndexedCharts + U0 report before editing.
2. Sketch the grid in a short plan comment / IMPL outline — then implement incrementally.
3. Extract mint click → `openReview()` → Confirm calls existing `handleOpen` (prefer refactor over duplicating tx build).
4. Run gates often. If e2e serves broken CSS, kill stale `next-server` on port 3001 (U0 lesson) and re-run.
5. End with web-design-guidelines / anti-slop grep on touched files (no `gradient`, `backdrop-blur`, `shadow-*` except intentional `shadow-none`).

## Notes from U0 (carry forward)

- `collateralLoaded` distinguishes loading vs no account — do not flash nudge during load.
- TopBar owns Spot; MarketHeader must not re-duplicate spot.
- Manual wallet check (nudge → deposit → Free readout → mint) still owed from U0; U1 should not make that harder. Note in IMPL if still unpaid.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
