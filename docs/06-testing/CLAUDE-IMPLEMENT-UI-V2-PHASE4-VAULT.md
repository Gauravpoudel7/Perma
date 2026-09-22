# CLAUDE-IMPLEMENT-UI-V2 — Phase U4 Vault

> **Product UI only** (Trade / Portfolio / Vault). Not landing page.  
> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (§7 U4), `BRAND-SYSTEM.md`, `UI-QA-CHECKLIST.md`, `APP-SHELL.md` §3 / Collateral, `COPY-DECK.md` §4.3–4.4, U0–U3 reports under `docs/audits/IMPL-UI-V2-U*-*.md`, ADR-0003 (no solvency %), and skills `perma-brand-lock`, `perma-honesty`, `perma-no-break`, `perma-fair-surface`.  
> **Plugins:** `frontend-design` ON. **Disable** ponytail and caveman.  
> **Model:** strongest available for visual work (Opus).

## Goal

Make `/vault` feel like an institutional collateral desk: clear summary hierarchy, deposit/withdraw choreography traders trust, and **louder-but-honest** insolvency / insufficient blocks — without softening `InsolventWithdrawal` gates, inventing APY/earn yield, or changing deposit/withdraw instruction bytes.

U0 already added `collateralLoaded`, CollateralNudge on Trade, and Required-free tiles. U3 gave `SlideOver`. Build on those.

## Current surface (evolve)

| Piece | Path | Notes |
|---|---|---|
| Page | `app/vault/page.tsx` | `max-w-4xl`; connect gate; summary + 2-col forms |
| Summary | `CollateralSummary.tsx` | Deposited / Locked / Available / Required free USDC; Skeleton via `collateralLoaded` |
| Required tile | `RequiredFreeUsdcTile.tsx` | Real µUSDC; never a % |
| Deposit | `DepositForm.tsx` | SOL + USDC inputs → Deposit |
| Withdraw | `WithdrawForm.tsx` | Live preflight via `canWithdraw` / `requiredFreeUsdc` |
| Blocks | `SolvencyBlock.tsx` / `InsufficientBlock` | COPY-DECK verbatim |
| Trade nudge | `trade/CollateralNudge.tsx` | Keep; do not regress |
| Panel | `primitives/SlideOver.tsx` | Reuse if adding review-before-submit |

## In scope

1. **Layout & hierarchy**
   - Full stage width (match Portfolio U3). Heading "Collateral" denser (`text-h3` or brand-consistent).
   - Summary tiles: emphasize **Available to withdraw** and **Required free USDC** (visual weight / order / hint copy from COPY-DECK). Still four honest tiles — no fifth "health %" tile.
   - Desktop: summary on top; Deposit | Withdraw side by side. Mobile: stack; 44px targets.
   - Disconnected → shared `EmptyState` (same pattern as Portfolio).

2. **Deposit choreography**
   - Clear labels (SOL / USDC), Max where free wallet balance is already readable without guessing.
   - Visible disabled reason above CTA (mirror Trade ticket).
   - Optional **Review deposit** via `SlideOver` before wallet prompt (amounts only — no APY). Cancel aborts; Confirm runs existing deposit path. Prefer this if it reduces mis-sends; skip a second confirm if it only adds friction without changing safety.
   - Success toasts / explorer links unchanged in meaning.

3. **Withdraw choreography (gates stay hard)**
   - Keep live `canWithdraw` / insufficient / solvency preflight — **do not** soften, bypass, or reword into a soft warning that still submits.
   - Elevate SolvencyBlock / InsufficientBlock (InlineError or alert styling within brand — still verbatim COPY-DECK sentences).
   - Show how much free USDC must remain (required free) next to the form when longs are open — computed from existing helpers, not a new ratio.
   - Optional Review withdraw SlideOver listing amount + "Required free USDC after" if that figure is already computable from current helpers; never invent mark-to-market.
   - Withdraw still allowed while paused if `useWalletGuard({ allowWhilePaused: true })` is current behavior — do not change pause semantics.

4. **Cross-links**
   - After successful first deposit, TopBar Free + Trade nudge should clear via existing refetch (verify; fix wiring only if broken — no new protocol).
   - Quiet link to Portfolio when locked > 0 ("Locked by open positions" → Portfolio) — optional, no new metrics.

5. **Docs**
   - Update `APP-SHELL.md` Vault section; COPY-DECK §4.3 for any new review/disabled strings.
   - Report: `docs/audits/IMPL-UI-V2-U4-VAULT-REPORT.md`.

## Out of scope / Forbidden

- `programs/**`, IDL, changing deposit/withdraw/settle instruction builders or `canWithdraw` math.
- APY, "earn", yield farming framing, TVL, solvency **ratio %**, unrealized P&L.
- Softening insolvency: never enable Withdraw when preflight says solvency/insufficient.
- Trade/Portfolio/chart refactors; bottom tabs (**U5**).
- Glass, gradients, soft shadows, radius > 8px, raw hex, off-token spacing.

## Acceptance

- [ ] Vault reads as collateral desk: clear summary + deposit/withdraw; Required free USDC prominent and honest.
- [ ] Insolvent / insufficient withdraw still blocked live with COPY-DECK alerts; no soft pass-through.
- [ ] Deposit/withdraw semantics unchanged; optional Review uses SlideOver a11y (Esc, focus trap).
- [ ] CollateralNudge on Trade still works; `collateralLoaded` skeleton preserved.
- [ ] `yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e` green in `apps/web`.
- [ ] Playwright 1440×900 and 390×844: no horizontal overflow; e2e ban "APY" / "earn" / "solvency ratio" / "P&L" in Vault headings/labels.
- [ ] Report at `docs/audits/IMPL-UI-V2-U4-VAULT-REPORT.md`.

## Method

1. Read DepositForm, WithdrawForm, RequiredFreeUsdcTile, SolvencyBlock, CollateralNudge, SlideOver before editing.
2. Prefer shared preflight/view-model extraction (like `usePositionSummary`) over duplicating `requiredFreeUsdc` arithmetic in JSX.
3. Evolve forms in place; do not greenfield a second vault.
4. Run gates often; kill stale next on 3001 if e2e CSS breaks.
5. Anti-slop grep on touched vault files.

## Notes from U0–U3

- Required free USDC = `premium_owed + Σ(accrued + margin)` over open longs — µUSDC, not a %.
- Wallet-connected manual pass still owed: connect → nudge → Vault deposit → Free updates → withdraw blocked when longs require free USDC → withdraw OK when safe.
- Indexer not required for Vault balances (RPC truth).

## Gate commands (from `apps/web`)

```bash
yarn typecheck && yarn test && yarn check-copy && yarn build && yarn test:e2e
```
