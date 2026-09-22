# IMPL-UI-V2-U3 — Portfolio Report

> **Scope:** `/portfolio` layout, position cards, detail sheet, history polish. No `programs/**`, IDL, or close / settle / burn semantics change. Trade desk, charts, Vault untouched.
> **Date:** 2026-09-22
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## What changed

### Shared pieces
- `primitives/SlideOver.tsx` — the slide-over chrome and a11y (scrim, `role="dialog"`, Esc, Tab wrap, initial focus) extracted from `trade/ReviewSheet.tsx`, plus `SlideOverRow`. `ReviewSheet` now renders through it with identical markup; the Trade e2e is unchanged and green. PERMA has one panel system, not two.
- `hooks/usePositionSummary.ts` — the accrued-premium math moved verbatim out of `PositionRow` (long: `projectedIndex` + `payableIfSettledNow`; short: `shortAccruedPremium` from the range accumulator). The row and the sheet both read it, so they cannot disagree. Still labeled "Est." everywhere.
- `lib/explorer.ts` — `explorerAddressUrl()` beside `explorerTxUrl()`, same cluster / custom-RPC handling.
- `primitives/Table.tsx` — `TableRow` accepts `className` / `onClick`, `TableHead` accepts `className`. Nothing else.

### Positions: one DOM, table on `md+`, cards below
`PositionsTable.tsx` / `PositionRow.tsx`: the `thead` hides below `md`; each `tr` becomes a `block` card with `p-4`; each `td` becomes a label/value flex row with a caption label that only shows in card mode. Same six facts as before. On desktop the numeric cells are `text-mono-md tabular-nums`. The Action cell gains a "Details" secondary button next to the unchanged `CloseSettleAction`; the whole row is clickable, with `stopPropagation` on the buttons. Selection state lives in `PositionsTable`, which re-derives the selected position from the live list each render (a position that closes while its sheet is open simply closes the sheet) and returns focus to that row's Details button.

Verified visually by rendering the exact row markup against the dev build's stylesheet at 1440 and 390 px (scratch page, not committed): a dense six-column table on desktop; stacked label/value cards with 44px action buttons on the phone.

### Position sheet — `PositionDetail.tsx`
`SlideOver` titled "Position", sub-line "Premium accrues continuously and settles when you close." Rows: Side, Realized range (+ ticks), Position size, Status badge, Accrued premium (Est.), Position account (truncated, "Copy" → "Copied" for 1.5 s via `navigator.clipboard`, "View account" explorer link). A "Open a similar position on Trade" link calls the existing `useTradeFormStore.setSide` / `setRange` before navigating — no new protocol surface. Footer: `CloseSettleAction` unchanged (same builders, same toasts). No extra confirm step: the wallet prompt is the confirmation, and a second click would not change transaction bytes.

Absent by design: P&L, mark-to-market, Greeks, liquidation, solvency ratio, charts.

### History — `HistoryTable.tsx`
Cash facts only, as before. New "When" column shows the indexer's `blockTime` as a UTC date-time and "—" when the indexer has none; it is never derived from the slot. Explorer links, watermark line and the four States branches unchanged.

### Page — `app/portfolio/page.tsx`
Full stage width. "Your Positions" (`h1`, `text-h3`) with a mono live count; History (`h2`, `text-h4`) only when connected. Disconnected renders the shared `EmptyState` with the verbatim connect prompt.

### Docs
`COPY-DECK.md` §4.2 (heading count, Details, sheet rows, History "When"); `APP-SHELL.md` §2 rewritten.

## Deliberately not built
- User-premium chart: no series endpoint exists (U2 note stands).
- Confirm step on Close / Settle: see above.
- Vault redesign — U4. Bottom tabs — U5.

## Gate (from `apps/web`, 2026-09-22)
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 7 files, 55 tests passed |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 71 passed, 4 skipped (pre-existing WebKit skips) |

New e2e (`e2e/shell.spec.ts`, "Portfolio"): no `h1, h2, h3, th, dt, label, figcaption` on `/portfolio` contains "p&l", "unrealized", "solvency ratio", "greeks" or "liquidation". Existing disconnected, overflow, banner and nav specs unchanged and green. Screenshots regenerated (intentional: full-width heading + EmptyState while disconnected).

## Manual verification still owed (carried from U0–U2, extended)
Wallet-connected on localnet: row → Details → the sheet's accrued figure equals the row's → Esc closes and focus lands on Details → Close / Settle from the sheet produce the existing toasts → "Open a similar position on Trade" lands on `/trade` with side and range prefilled. Not driven by Playwright (no wallet extension). Instruction builders and `useSendPermaTx` untouched.
