# APP SHELL: PERMA Trade Interface

## Layout Architecture
The app uses a **Fixed Side-Nav** and a **Main Stage** approach, similar to Linear or Coinbase Institutional.

## Core Views

### 1. The Trade Stage (Primary)
- **Top Bar**: Wallet connect, SOL/USDC balance, Market Status (Active/Paused).
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
- **Active Positions Table**:
    - Side | Range | Size | Accrued Premium (Est.) | Status (Open / Pending Premium) | Action: [Close] / [Settle].
    - **No P&L column.** No P&L instruction exists on-chain — a short's realized LP result
      (`returned − locked`) is applied once, at close, and a long always closes at P&L = 0
      (see [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). There is nothing "unrealized"
      to show for either leg.
- **Collateral Summary Card** (Vault, not Portfolio — implemented at `apps/web/src/app/vault`):
    - Deposited | Locked | Available | **Required free USDC** (a real µUSDC amount:
      `premium_owed_usdc + Σ(accrued + margin)` over open longs). **Not a "Solvency Ratio (%)"**
      — Fair MVP reads no price, so no ratio can be honestly computed (ADR-0003).

### 3. Earn/Collateral View
- **Deposit Interface**: Simple SOL/USDC input fields $\rightarrow$ [Deposit].
- **Withdraw Interface**: Amount field $\rightarrow$ [Withdraw] (blocked live, before submission, when the
  amount would leave less than the owner's open longs owe — the exact `InsolventWithdrawal` gate,
  not a heuristic warning).

## Interaction Details
- **Transaction Toasts**: Bottom-right notifications. 
    - *States*: Pending $\rightarrow$ Confirmed (with Explorer Link) or Failed (with Error Code).
- **Price Ticker**: A minimal, monochromatic price feed for the SOL/USDC pool at the top of the screen.

## UI/UX Constraints
- **No Pop-ups**: Use slide-over panels or inline expansion for details.
- **Focus State**: When a position is selected in the portfolio, the Trade Panel updates to "Manage Position" mode (Close/Adjust).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
