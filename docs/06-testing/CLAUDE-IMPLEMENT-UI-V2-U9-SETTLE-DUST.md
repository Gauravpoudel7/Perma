# CLAUDE-IMPLEMENT — U9 Portfolio: hide Settle on dust accrued

> **Read first:** `apps/web/src/components/portfolio/CloseSettleAction.tsx`, `PositionRow.tsx`, `PositionDetail.tsx`, `hooks/usePositionSummary.ts`, `lib/solvency.ts` (`payableIfSettledNow`), COPY-DECK Close/Settle strings, `perma-no-break`, `perma-honesty`.  
> **Plugins:** frontend-design ON only if copy changes. Ponytail/caveman OFF.  
> **Measured:** After `settle_premium`, a long stays OPEN and accrues again. `hasAccrued = accrued > 0n` shows **Settle** for Est. **0.000001 USDC** (1 µUSDC) immediately — honest but noisy (Solana-devnet screenshot 2026-09-23).

## Goal

Keep Settle for meaningful rent; hide it for dust so users don’t think settle failed. **Close** still always available for longs/shorts.

## In scope

1. Introduce one named constant, e.g. `SETTLE_DUST_USDC_MICRO = 1_000n` (0.001 USDC) — or justify a different floor in the report (must be ≥ 1 µUSDC, must not hide real rent). Prefer **0.001 USDC** (1000 µUSDC) unless COPY-DECK already names a threshold.
2. `showSettle = leg === LONG && accrued >= SETTLE_DUST_…` in CloseSettleAction / callers (single source of truth — don’t fork Row vs Detail).
3. Detail sheet still **displays** the honest Est. accrued even when below the Settle threshold (honesty: show the number, hide only the action).
4. Unit test: accrued `0`, `1`, `999`, `1000`, `1001` µUSDC → Settle visibility matches the constant.
5. One-line COPY-DECK or comment: Settle appears when estimated owed ≥ threshold; below that use Close (which settles on burn).
6. Audit: `docs/audits/IMPL-UI-V2-U9-SETTLE-DUST-REPORT.md`

## Out of scope / Forbidden

- Changing on-chain settle/burn math or rounding  
- Auto-closing longs  
- Hiding Accrued Premium column  
- Inventing P&L  

## Gate

```bash
cd apps/web && yarn typecheck && yarn test && yarn check-copy
# manual: long with Est. 0.000001 → Settle hidden; Close still works; after more accrual ≥ threshold → Settle returns
```
