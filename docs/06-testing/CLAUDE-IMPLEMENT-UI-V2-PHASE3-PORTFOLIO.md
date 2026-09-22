# CLAUDE-IMPLEMENT-UI-V2 — Phase U3 Portfolio

> **Product UI only** (Trade / Portfolio / Vault). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (§3 Portfolio, §7 U3), `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md` §2, `COPY-DECK.md` §4.2, U0–U2 reports under `docs/audits/IMPL-UI-V2-U*-*.md`, ADR-0003 (no unrealized P&L), and skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman.  
> **Model:** strongest available for visual work (Opus).

## Goal

Make `/portfolio` feel like a business-grade positions desk: denser table on desktop, cards on mobile, a **PositionDetail slide-over**, and honest indexer **History** — without inventing unrealized P&L, solvency %, or changing close/settle semantics.

U0–U2 already shipped shell, Trade desk, ReviewSheet pattern, States, and charts. Reuse those patterns; do not regress Trade.

## Current surface (evolve)

| Piece | Path | Notes |
|---|---|---|
| Page | `app/portfolio/page.tsx` | `max-w-4xl`; connect gate; Positions + History |
| Table | `components/portfolio/PositionsTable.tsx` | Side · Range · Size · Accrued Premium · Status · Action |
| Row | `PositionRow.tsx` | Accrued Est. via solvency helpers; CloseSettleAction |
| Empty | `EmptyPositions.tsx` | Uses States |
| History | `HistoryTable.tsx` | Indexer `/positions/{owner}/history`; cash facts only |
| Close/Settle | `CloseSettleAction.tsx` (and related hooks) | **Keep tx semantics** |
| Slide-over precedent | `components/trade/ReviewSheet.tsx` | Match a11y: Esc, focus trap, focus return |

## In scope

1. **Layout density**
   - Widen stage (drop overly narrow feel; align with shell padding from U0). Keep Prototype banner + TopBar.
   - Desktop (≥768): denser `PositionsTable` — tabular-nums on size/premium/ticks; clearer Est. labeling from COPY-DECK; explorer link where a signature exists if already available.
   - Mobile (<768): **position cards** (same fields as table columns). Prefer one shared data mapping so table and cards cannot disagree. 44px action targets.

2. **PositionDetail slide-over**
   - Clicking a row/card opens a right slide-over (ReviewSheet-class chrome: 1px border, no glass/shadow, solid scrim).
   - Show **only real Fair fields:** side, realized/price range + ticks, size/liquidity, status (Open / Pending Premium), Accrued Premium (Est.) with the existing note that premium settles on close, Close/Settle actions (reuse `CloseSettleAction` or extract shared hook — do not fork instruction builders).
   - Optional: pubkey truncated + copy; link to Trade with range prefilled **only if** trade form store already supports setters without new protocol surface.
   - **Forbidden in detail:** unrealized P&L, mark-to-market %, Greeks, liq distance, solvency ratio, fake charts.
   - Esc / focus trap / focus return to the triggering control.

3. **History**
   - Keep cash-only HistoryTable behavior (closed + settlements).
   - Polish loading / not configured / degraded / empty via States (already partly there).
   - If indexer returns rows: denser table + explorer links (existing `explorerTxUrl`).
   - If empty or degraded: honest EmptyState / DegradedState — never invent history.
   - Do **not** build a user-premium LWC chart unless a real series endpoint exists (U2 deferred this correctly).

4. **Empty / disconnect choreography**
   - Disconnected: EmptyState or existing connect copy; consistent with Trade’s clarity.
   - Connected + no positions: keep EmptyPositions CTA toward Trade (COPY-DECK).

5. **Docs**
   - Update `APP-SHELL.md` §2 Portfolio for cards + slide-over.
   - COPY-DECK §4.2 for any new detail/sheet strings; `check-copy` green.
   - Report: `docs/audits/IMPL-UI-V2-U3-PORTFOLIO-REPORT.md`.

## Out of scope / Forbidden

- `programs/**`, IDL, reshaping close/settle/burn/deposit semantics.
- Unrealized P&L column, solvency %, TVL/APY, Greeks, multi-leg, liquidation gauges.
- Trade desk / chart refactors (U1/U2 stay).
- Vault redesign (**U4**); bottom tab bar (**U5**).
- Glass, gradients, soft shadows, radius > 8px, raw hex, off-token spacing.
- Softening Pending Premium / Insolvent / pause guards.

## Acceptance

- [ ] Desktop table denser; mobile cards; same facts as today (no new invented metrics).
- [ ] PositionDetail slide-over with Close/Settle; Esc + focus trap; no forbidden metrics.
- [ ] History remains cash-facts-only with honest empty/degraded states.
- [ ] Close/Settle still works on localnet (manual note OK if Playwright has no wallet).
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green in `apps/web`.
- [ ] Playwright 1440×900 and 390×844: no horizontal overflow; banner intact; screenshots only if intentional.
- [ ] Report at `docs/audits/IMPL-UI-V2-U3-PORTFOLIO-REPORT.md`.

## Method

1. Read PositionRow, CloseSettleAction, HistoryTable, ReviewSheet, ADR-0003 notes in APP-SHELL before editing.
2. Prefer extract shared “position summary” view-model over duplicating accrued math.
3. Implement slide-over by cloning ReviewSheet a11y patterns, not a third modal system.
4. Run gates often; kill stale `next-server` on 3001 if e2e CSS breaks.
5. Anti-slop grep; e2e assert no "P&L" / "unrealized" / "solvency ratio" / "greeks" in Portfolio headings/labels (mirror Trade ban).

## Notes from U0–U2

- Accrued Premium is **Est.** and settles on close — keep that honesty.
- OpenPositionsStrip on Trade links here — detail sheet should feel like the destination for that strip.
- Wallet-connected manual pass still owed (now include: open detail → Close/Settle Cancel/Confirm if you add a confirm step; prefer confirm only if it reduces misclicks without changing tx bytes).
- Indexer prefer `:8799`.

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
