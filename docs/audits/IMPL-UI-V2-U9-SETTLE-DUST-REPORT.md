# IMPL-UI-V2-U9 — Hide Settle on dust accrued

> **Scope:** when the Portfolio offers the Settle action. No `programs/**`, IDL, instruction-builder or accrual-math change.
> **Date:** 2026-09-23
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## The defect

`settle_premium` leaves a long **open**, so it begins accruing again immediately. With `hasAccrued = accrued > 0n`, the row re-offered **Settle** for an estimated **0.000001 USDC** (1 µUSDC) as soon as the previous settle confirmed — which reads as "the settle failed" (devnet, 2026-09-23). The number was honest; the action was noise.

## The floor

`SETTLE_DUST_USDC_MICRO = 1_000n` (0.001 USDC) and `isSettleable(accrued)` now live in `lib/solvency.ts`, beside the rest of the ADR-0003 math. COPY-DECK named no existing threshold, so the brief's preferred value stands. It is 1000× the smallest representable amount and far below real rent — at the deployed parameters a 1e6-liquidity long owes ~9 USDC per hour (`estPremiumPerHour`), so the floor can only ever hide a rounding tail, never rent. A unit test asserts both bounds: the floor is ≥ 1 µUSDC and strictly less than an hour of rent on a real position, so it cannot be tuned into hiding a settleable amount.

Nothing on-chain changed. The program keeps its own `require!(payable > 0, NothingToSettle)` guard, and **Close** still settles whatever is owed at burn, so no premium is ever stranded by this.

## One producer, not two

`s.accrued > 0n` had been computed independently in `PositionRow.tsx` and `PositionDetail.tsx` — two copies of a rule that can drift. `usePositionSummary` now returns `canSettle = isLong && isSettleable(accrued)`, and both callers pass that. A post-change grep shows `hasAccrued=` has exactly two call sites and one producer.

`CloseSettleAction` was not switched to calling `usePositionSummary` itself: that would mount a second `useRangeState` poller per row, the exact duplication U6 removed from Trade. It keeps its prop, with a comment naming where the value comes from, and keeps its own `LEG_LONG` check as a belt to the summary's braces.

## Honesty

The detail sheet still shows the real figure — "Accrued premium · Est. 0.000001 USDC" — whatever its size, and when a long's accrued sits between zero and the floor it gains one muted line: "Below the settle threshold; closing settles it." That is the sentence that answers "did my settle fail?". The Portfolio table's Accrued Premium column is untouched, and no P&L or derived figure was introduced.

## Verification

| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 10 files, 75 tests passed (+2 `isSettleable`) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 89 passed, 13 skipped (unchanged from U8) |

`isSettleable` is tested at 0, 1, 999, 1 000, 1 001 and 9 000 000 µUSDC — false below the floor, true from it up.

No new e2e: both Settle and its absence require a connected wallet holding an open long, which Playwright cannot produce in this suite.

## Manual, still owed (needs a wallet and an open long)
Settle a long → Settle disappears while "Est. 0.000001 USDC" and the new hint remain → Close still works → after accruing past 0.001 USDC, Settle returns.
