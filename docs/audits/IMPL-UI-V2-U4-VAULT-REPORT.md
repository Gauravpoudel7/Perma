# IMPL-UI-V2-U4 — Vault Report

> **Scope:** `/vault` hierarchy, deposit / withdraw choreography, review sheets. No `programs/**`, IDL, instruction-builder or gate-math change. Trade, Portfolio, charts untouched except `useOpenPosition` now reading the shared hook.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### One solvency view-model — `hooks/useRequiredFreeUsdc.ts`
`projectedIndex` + `requiredFreeUsdc` over the owner's open longs, previously copied in `RequiredFreeUsdcTile`, `WithdrawForm` and `useOpenPosition`, now lives once and returns `{ required, freeUsdc, openLongsCount, marketRiskFields }`. All three consumers read it. `lib/solvency.ts` is untouched; the numbers are the same.

### Summary hierarchy — `CollateralSummary.tsx`, `DataTile.tsx`
`DataTile` gains `tone` (value color) and an `action` slot; `value` accepts nodes so a SOL/USDC pair can stack in a narrow tile and sit on one line at `xl`. Tile order: Available to withdraw (white) · Required free USDC (white, hint "{n} open longs" / "No open longs") · Locked by open positions (muted, "View positions" → Portfolio when non-zero) · Deposited (muted). Four tiles; no health percentage. The `collateralLoaded` skeleton is unchanged.

### Deposit — `DepositForm.tsx`
Visible disabled reason above the CTA (guard reason or "Enter an amount."). "Deposit" opens a **Review deposit** slide-over listing the SOL and USDC amounts; Cancel aborts before any wallet prompt, Confirm runs the unchanged `handleDeposit` (ATA creation, WSOL wrap, `deposit_collateral`). No Max chip: the wallet's own SOL/USDC balances are not read anywhere in the app, and a guessed figure is forbidden. Helper copy is the COPY-DECK asset note plus the fee sentence.

### Withdraw — `WithdrawForm.tsx`, `SolvencyBlock.tsx`
- Preflight logic unchanged (`amount > free` → insufficient; `!canWithdraw(free, amount, required)` → solvency); the button is disabled whenever the preflight fails. No soft pass-through.
- `InsufficientBlock` / `SolvencyBlock` now render inside `InlineError` (bordered surface, `role="alert"`, danger text) with the verbatim COPY-DECK sentences.
- New, derived only from existing figures: `withdrawable = max(0, free − required)`, shown as "Withdrawable while your longs stay covered: {n} USDC" with a "Max" chip that fills the input. When no longs are open, `required` is `premium_owed_usdc`, which is still the gate's number.
- "Withdraw" opens a **Review withdrawal** slide-over: Amount · Free USDC after · Required free USDC (+ open-long count). Confirm runs the unchanged `handleWithdraw`, including its fresh `fetchFreshOpenLongs` before building the instruction. `useWalletGuard({ allowWhilePaused: true })` unchanged.

### Review sheet — `VaultReviewSheet.tsx`
A thin `SlideOver` user (rows + confirm label). Same a11y as the Trade ReviewSheet: initial focus on Cancel, Esc, Tab wrap, focus returned to the form's CTA.

### Page — `app/vault/page.tsx`
Full stage width, "Collateral" as `h1 text-h3`, Deposit | Withdraw side by side from `md`, `EmptyState` with the verbatim connect prompt while disconnected.

### Cross-links (verified by reading the wiring)
`useSendPermaTx.send` calls `refetchAll` after confirmation, which sets `userCollateral`; `TopBar` ("Free …") and `trade/CollateralNudge` both select that slice, and `collateralLoaded` is already true, so a first deposit clears the nudge and updates the Free readout with no new wiring.

### Docs
`COPY-DECK.md` §4.3 (tile order, disabled reasons, Max / withdrawable line, both review sheets, asset note); `APP-SHELL.md` §3 rewritten as "Collateral View (Vault)".

## Deliberately not built
- Deposit Max — no wallet-balance read exists; adding one is a new RPC read the brief did not ask for.
- SOL withdrawal — the form was USDC-only before U4 and the instruction is sent with `amountA: 0n`; unchanged.
- Any ratio, APY, or "earn" framing.

## Gate (from `apps/web`, 2026-09-22)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 7 files, 55 tests passed |
| `yarn check-copy` | "No banned phrases found." (one hit in a code comment was reworded) |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 74 passed, 4 skipped (pre-existing WebKit skips) |

New e2e (`e2e/shell.spec.ts`, "Vault"): no `h1, h2, h3, th, dt, label, figcaption` on `/vault` matches `\bapy\b`, `\bearn\b`, "solvency ratio", "p&l" or "unrealized". Existing disconnected (`Collateral` heading, connect prompt, no "solvency ratio"), overflow, banner and nav specs unchanged and green.

Visual check: the connected summary + forms markup rendered against the built stylesheet at 1440 and 390 px (scratch page, not committed). After the first pass the SOL/USDC pair wrapped mid-value in the phone tiles; it now stacks as two lines below `xl`.

Screenshots regenerated (intentional: full-width heading + EmptyState while disconnected).

## Manual verification still owed (carried from U0–U3, extended)
Wallet-connected on localnet: connect → Trade nudge → Vault deposit → Review → Confirm → TopBar Free and nudge update → open a long → withdraw above "withdrawable" shows the solvency alert with a disabled button → Max → Review withdrawal → Confirm succeeds. Not driven by Playwright (no wallet extension). Instruction builders, `useSendPermaTx` and `lib/solvency.ts` untouched.
