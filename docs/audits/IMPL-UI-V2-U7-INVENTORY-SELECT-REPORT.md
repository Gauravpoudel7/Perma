# IMPL-UI-V2-U7 — Pick a range from inventory; toast lifecycle

> **Scope:** Trade range selection and toast lifecycle in `apps/web`. No `programs/**`, IDL, instruction-builder, solvency or guard change.
> **Date:** 2026-09-23
> **Status:** Prototype. Not audited. Single pool. Not production mainnet risk capital.

## A — Pick a range from inventory

### The defect, reproduced
A long can only open against short liquidity in the **same** tick range, but the ticket could only reach a range through the ±8/±32/±128 spot presets. On the live validator the ticket's default range `[-40176, -38168]` holds **0** available while the only real short sits in `[-40168, -38120]` with **5** available — eight ticks away, visible on the chart, unreachable from the form. The screenshot at `docs/04-ui-ux/screenshots/trade-desktop.png` shows both figures side by side.

### Data source: chain, not indexer
The picker reads every `RangePremiumState` for the market with Anchor's `program.account.rangePremiumState.all([{ memcmp: { offset: 8, bytes: market } }])` — the same `.all()` pattern (and discriminator caveat) as `fetchAllPositionsForOwner` in `lib/accounts.ts`. Indexed buckets were the obvious source, but the failure was measured on Solana-devnet where no indexer is hosted; an indexer-only picker would not exist exactly where it is needed. The U2 charts keep their indexer source and every honesty rule.

### What shipped
- `lib/inventory.ts` — `toInventoryRanges()` (BN → bigint, `available = short − long` floored at zero, sorted by `tickLower`) and `bestAvailableRange()` (largest available, ties broken by nearness to the pool tick, `null` when nothing is available). Both unit-tested, including a u128 at the top of its range.
- `hooks/useInventoryRanges.ts` — 20 s poll through the existing `usePolledAccount`, cached in a new read-only `useChainStore.inventoryRanges` slice. No transaction reads it.
- `components/trade/InventoryPicker.tsx` — one native `<button>` per range holding shorts (price band, exact ticks, available), `aria-pressed` on the active row, plus **"Use available short"** which jumps to `bestAvailableRange` and is disabled with an honest title when every range is empty. Selecting writes that range's **exact** ticks via the existing `useTradeFormStore.setRange`. Native buttons give Enter/Space and focus rings for free.
- `useTradeFormStore` gained `rangeSource` (`default | manual | preset | inventory`); `RangeInput` shows "Selected range from inventory." only when the ticks came from the picker or a bar, and the presets/slider reset it. The ±8/±32/±128 presets are untouched.
- `charts/InventoryChart.tsx` — `subscribeClick` maps a clicked bar back to its bucket and calls the same setter; unsubscribed on cleanup. A mouse shortcut layered on the keyboard path, never the only way in.

## B — Toast lifecycle

`useToastStore` had a `dismiss` nobody called and no timers, so every confirmation stacked forever.

- The store moved out of `components/primitives/ToastContainer.tsx` into `store/useToastStore.ts` (no JSX), which also makes it testable headlessly.
- `TOAST_TIMEOUT_MS = { success: 6_000, error: 12_000 }` and `MAX_TOASTS = 3`. A **pending** toast never expires — it is replaced in place when the transaction resolves, and a "Confirm in your wallet" that vanished mid-send would misreport the state. `update()` starts the clock when pending becomes success or error, which is the path every transaction takes. `push()` drops the oldest beyond three and clears its timer.
- `Toast.tsx` gained a "Dismiss" button (`aria-label`, focus ring, word not glyph — PERMA ships no icon set). "View transaction" links are unchanged.

## Verification
| Check | Result |
|---|---|
| `yarn typecheck` | clean |
| `yarn test` | 10 files, 71 tests passed (+5 toast lifecycle, +3 inventory helpers) |
| `yarn check-copy` | "No banned phrases found." |
| `yarn build` | Compiled successfully |
| `yarn test:e2e` | 83 passed, 8 skipped (pre-existing WebKit skips) |

New e2e ("Inventory range picker") runs against the live validator on all three projects and **did select** (it did not take its honest-skip path): it focuses the first row, presses Enter, and asserts `aria-pressed="true"`, that the ticket's "Realized range" readout now names that row's exact ticks, and that "Selected range from inventory." appears. On mobile it opens the U5 "Market data" disclosure first.

Toast timing is unit-tested with fake timers: success clears at 6 s and not before, error survives 6 s and clears at 12 s, pending survives 24 s then clears 6 s after resolving, `dismiss` is immediate and cancels the pending timer, and a fourth push drops the oldest.

## Manual, still owed (needs a wallet)
On devnet: Long → pick a row with available liquidity → size accepted and the inventory block clears → open the position → the success toast clears itself within ~6 s and "Dismiss" kills it immediately.
