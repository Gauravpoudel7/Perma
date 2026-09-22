# CLAUDE-IMPLEMENT — U7 Trade: click inventory → select range + toast dismiss

> **Read first:** `docs/04-ui-ux/PRODUCT-UI-V2-RESEARCH.md` (honesty), `apps/web/src/components/trade/IndexedCharts.tsx`, `charts/InventoryChart.tsx`, `RangeInput.tsx`, `store/useTradeFormStore.ts`, `components/primitives/Toast.tsx`, `ToastContainer.tsx`, `hooks/useSendPermaTx.ts`, `perma-no-break`, `perma-honesty`, COPY-DECK range/inventory/toast wording.  
> **Plugins:** frontend-design ON. Ponytail/caveman OFF.  
> **Model:** strongest available.

## Problem (measured from Solana-devnet use)

1. Longs need short liquidity in the **same tick range**. The ticket only sets range via spot presets (±8 / ±32 / ±128). Inventory chart shows where shorts exist but is display-only. Users land on a wide empty band (±128), see “No short liquidity in this range,” and cannot open a long even when a short bar is visible next to them.
2. Success toasts (**Deposit confirmed**, **Position opened**, etc.) **never vanish**. `Toast.tsx` / `ToastContainer.tsx` have no auto-dismiss and no close control — they stack forever in the bottom-right after each tx (measured on Solana-devnet Trade/Vault).

## Goal

A. Make inventory the way you **pick** a range when opening a **long** (and optionally when opening a short to match an existing band).  
B. Make toasts **time out** (and be manually dismissible) so the UI does not fill with stale confirmations.

## In scope

### A — Inventory → select range

1. **Click / activate an inventory bucket** on `InventoryChart` (or a small list under it) → write `tickLower` / `tickUpper` into `useTradeFormStore` exactly as that bucket’s ticks (not a nearby preset).
2. When side is **Long**, add a control **"Use available short"** that selects the bucket with the largest `shortLiquidity` (ties: nearest to spot). Disabled when no short inventory.
3. After selection, RangeInput / InventoryStrip / SizeInput must refresh against the new ticks (existing pollers).
4. Keyboard: bucket / list row is focusable; Enter/Space selects.
5. Copy (honest): e.g. “Selected range from inventory” under Realized range when the ticks came from a bucket, not a preset.
6. Tests: unit for “pick bucket → store ticks”; e2e or component test that Long + click bucket clears the empty-range block when that bucket has short liquidity.

### B — Toast lifecycle (must ship in this phase)

7. **Auto-dismiss** success toasts after ~5–8 seconds (exact ms in one named constant). Pending toasts stay until replaced by success/error (existing `useSendPermaTx` flow). Errors stay longer (e.g. ~12s) or until dismissed — never silent-fail.
8. **Manual dismiss**: visible close control (button or icon button) on every toast; `dismiss(id)` already exists on `useToastStore` — wire it.
9. Cap stack depth (e.g. keep last 3) so a spam of confirms cannot cover the ticket.
10. Unit test: success toast is removed after the timeout (fake timers).

11. Audit note: `docs/audits/IMPL-UI-V2-U7-INVENTORY-SELECT-REPORT.md` (cover both A and B).

## Out of scope / Forbidden

- Inventing inventory or premium series  
- Changing on-chain programs  
- Auto-opening a long  
- Labelling inventory as an order book  
- Breaking ±8/±32/±128 presets (keep them)  
- Removing “View transaction” links  
- Toast spam / sound / confetti

## Gate

```bash
cd apps/web && yarn typecheck && yarn test && yarn check-copy
# manual A: Solana-devnet Trade → Long → click short bar → realized range matches → Available > 0 → can enter size
# manual B: deposit or open position → success toast appears → vanishes on its own within ~8s; X dismisses immediately
```
