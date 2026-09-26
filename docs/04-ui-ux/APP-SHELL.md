# APP SHELL: PERMA Trade Interface

## Layout Architecture
The app uses a **Fixed Side-Nav** and a **Main Stage** approach, similar to Linear or Coinbase Institutional.

## Core Views

### 1. The Trade Stage (Primary)
- **Desk grid** (`components/trade/TradePanel.tsx`): ≥1280px = viz pane left (flex) + 384px order ticket right; 768–1279px = stacked, viz above ticket; <768px = ticket first. The desk renders without a wallet — inventory and charts are public RPC/indexer reads — and only the ticket's CTA slot swaps for "Connect a wallet to continue."
- **Viz pane**: `InventoryStrip` (live short / long / available liquidity for the selected range, from `RangePremiumState`; labeled inventory, never order book or depth) above `IndexedCharts` — two TradingView Lightweight Charts v5 canvases (`components/trade/charts/`, loaded client-only via `next/dynamic`, themed from `tokens.css` at mount, `autoSize`, removed on unmount). **Premium index**: x = slot, y = `GlobalPremiumIndex` value, one dot per recorded row from `/premium/series`, a dashed "Live index (RPC)" reference line from the polled account. **Inventory by range**: one bar per indexed tick range (short muted, long white), an arrow on the bar equal to the ticket's range — the only range overlay, because each bar *is* a tick range; the premium chart has no price axis to project ticks onto, so it carries no band. Empty / loading / degraded states are sentences, never a placeholder series.
- **Order ticket**, top to bottom: `CollateralNudge` (zero collateral only) → "Open Position" + market label → Side toggle → Price Range (slider windowed ±512 spacings around spot, "Around spot" ±8/±32/±128 presets, tick-snap helper, realized range, rent notice) → Position Size (inventory-gated on long) → Est. premium per hour (long) → visible disabled reason → CTA.
- **ReviewSheet** (`components/trade/ReviewSheet.tsx`): the CTA opens a right-anchored slide-over listing only transaction inputs and chain-checked figures — market, side, realized range, size, est. premium/hour + required margin + free USDC (long), slippage caps (short), rent line when a tick array is missing. "Cancel" aborts before any wallet prompt; "Confirm Open Short/Long" runs the unchanged mint path (`hooks/useOpenPosition.ts` → `useSendPermaTx`). Esc closes, focus is trapped inside and returns to the CTA.
- **Open positions strip** under the grid: up to 5 live positions (side, range, size, status) with a link to Portfolio. No premium column, no P&L.
- **Top Bar** (one dense row, every route): wordmark · market label "SOL/USDC · Orca Whirlpool" · "Spot" readout (Orca Whirlpool read, polled) · Market Status (Active/Paused) · free SOL/USDC collateral when connected · Wallet connect. Below `md` the market label and free-collateral group hide; below `sm` the quiet "Active" badge hides too ("Paused" always shows).
- **Market Selector**: Single-select dropdown (currently only SOL/USDC).
- **Trade Panel (Center)**:
    - **Range Input**: Dual-slider for `Tick Lower` and `Tick Upper`.
    - **Size Input**: Number field for liquidity size.
    - **Position Toggle**: [Short / Long] switch.
    - **Live Preview**: 
        - "Collateral Required: X.XX USDC"
        - "Est. Premium/Hour: Y.YY USDC"
    - **Action Button**: [Open Position] (High contrast white button).

### 2. Portfolio View
- **Active Positions Table** (`components/portfolio/PositionsTable.tsx`, full stage width):
    - Side | Range | Size | Accrued Premium (Est.) | Status (Open / Pending Premium) | Action: [Details] [Close] / [Settle]. A Pending Premium short does not get Close (`burn_position` requires Open). It gets Settle when the range escrow can pay, or the waiting line from COPY-DECK when it cannot.
    - Below `md` the header hides and every row lays out as a card with a caption label per cell — the same `<table>` element restyled, so cards and table read one set of facts from one view-model (`hooks/usePositionSummary.ts`).
- **Position sheet** (`PositionDetail.tsx`, on `primitives/SlideOver.tsx` — the same panel the Trade ReviewSheet uses: scrim, 1px left border, Esc, focus trap, focus returned to the row's Details button): side, realized range + ticks, size, status, accrued premium (Est.), position account (copy + explorer), "Open a similar position on Trade" (prefills the ticket via the trade form store), and the same `CloseSettleAction` as the row in the footer. Pending Premium uses its own sub-line (liquidity already withdrawn). No P&L, mark, health or solvency figure — none exists on-chain for Fair.
- **History** (indexer, cash facts only): Event · Detail · When (block time when indexed, "—" otherwise) · Slot · Transaction. Loading / not configured / degraded / empty are the shared States, never invented rows.
    - **No P&L column.** No P&L instruction exists on-chain — a short's realized LP result
      (`returned − locked`) is applied once, at close, and a long always closes at P&L = 0
      (see [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). There is nothing "unrealized"
      to show for either leg.
- **Collateral Summary Card** (Vault, not Portfolio — implemented at `apps/web/src/app/vault`):
    - Deposited | Locked | Available | **Required free USDC** (a real µUSDC amount:
      `premium_owed_usdc + Σ(accrued + margin)` over open longs). **Not a "Solvency Ratio (%)"**
      — Fair MVP reads no price, so no ratio can be honestly computed (ADR-0003).

### 3. Collateral View (Vault)
- **Summary** (`vault/CollateralSummary.tsx`, full stage width, 2×2 → 4 across at `xl`): Available to withdraw and Required free USDC in white, Locked by open positions (with a "View positions" link when non-zero) and Deposited in muted. One view-model, `hooks/useRequiredFreeUsdc.ts`, feeds the tile, the withdraw preflight and the long-mint preflight; it is a µUSDC amount, never a ratio.
- **Deposit** (`DepositForm.tsx`): SOL (wrapped) + USDC inputs, visible disabled reason, "Deposit" opens a Review deposit slide-over (amounts only); Confirm runs the unchanged deposit instructions.
- **Withdraw** (`WithdrawForm.tsx`, SOL and USDC; SOL is unwrapped back to the wallet, mirroring Deposit): a "Max" chip per token (SOL: free SOL; USDC: free − required) and a "Withdrawable while your longs stay covered" line for USDC; the `InsufficientFunds` / `InsolventWithdrawal` preflight blocks live, before submission, as a bordered alert with the verbatim sentences and a disabled button — never a soft warning that still submits. "Withdraw" opens a Review withdrawal slide-over (Amount · Free USDC after · Required free USDC); Confirm runs the unchanged withdraw path, including its fresh open-longs fetch. Allowed while paused, as before.
- Both review sheets use `primitives/SlideOver.tsx` (Esc, focus trap, focus returned to the CTA).

## Interaction Details
- **Transaction Toasts**: Bottom-right notifications. 
    - *States*: Pending $\rightarrow$ Confirmed (with Explorer Link) or Failed (with Error Code).
- **Price Ticker**: A minimal, monochromatic price feed for the SOL/USDC pool at the top of the screen.

## Mobile product mode (<768px)
- **Chrome**: one fixed bottom stack — `MobileTabBar` (Trade · Portfolio · Vault · Markets, text labels, 44px rows, `aria-current`, solid background, 1px rule) directly above the verbatim `PrototypeBanner`, which stays bottom-most and is never covered. The left `Sidenav` is not rendered visibly below `md`; from `md` the sidenav returns and the tab bar hides. Both are CSS breakpoints, never resize listeners. `<main>` and toasts pad for `--shell-banner-h` (+ `--shell-tabbar-h` on phones) from `tokens.css`.
- **Trade**: ticket first; the viz pane (inventory strip + charts) sits behind a "Market data" disclosure that starts closed, so first paint is the ticket. From `md` the pane is always visible. One chart instance either way; the chart refits when the pane gains width.
- **Sheets**: `SlideOver` covers the tab bar (scrim above it) and pads its footer above the banner, which stays on top. Esc, focus trap and focus return unchanged.
- **Touch**: range-slider handles are 24px on coarse pointers and phone widths; primary buttons, tab rows and sheet footers are ≥44px.
- Not in scope: PWA / install prompt, native bottom-sheet physics, swipe gestures, icon packs.

## Shared States
Every screen renders "nothing to show" through one of four primitives in `apps/web/src/components/primitives/States.tsx`: `Skeleton` (static block, `aria-label` "Loading"), `EmptyState` (a fact about the chain), `DegradedState` (indexer missing or stale; RPC state unaffected), `InlineError` (`role="alert"`, optional recovery CTA). No page invents its own loading or empty markup.

## Post-connect Collateral Nudge
On Trade, a connected wallet whose `UserCollateral` is absent or all-zero sees an inline, non-blocking notice with a link to Vault (copy in COPY-DECK §4.4). No modal, no toast, no dismiss state; it disappears once a deposit lands.

## UI/UX Constraints
- **No Pop-ups**: Use slide-over panels or inline expansion for details.
- **Focus State**: When a position is selected in the portfolio, the Trade Panel updates to "Manage Position" mode (Close/Adjust).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
