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
    - Position ID | Type | Range | Size | Unrealized P&L | Premium Accrued | Action: [Close].
- **Collateral Summary Card**:
    - Total Balance | Locked | Available | Solvency Ratio (%).

### 3. Earn/Collateral View
- **Deposit Interface**: Simple SOL/USDC input fields $\rightarrow$ [Deposit].
- **Withdraw Interface**: Amount field $\rightarrow$ [Withdraw] (with solvency check warning).

## Interaction Details
- **Transaction Toasts**: Bottom-right notifications. 
    - *States*: Pending $\rightarrow$ Confirmed (with Explorer Link) or Failed (with Error Code).
- **Price Ticker**: A minimal, monochromatic price feed for the SOL/USDC pool at the top of the screen.

## UI/UX Constraints
- **No Pop-ups**: Use slide-over panels or inline expansion for details.
- **Focus State**: When a position is selected in the portfolio, the Trade Panel updates to "Manage Position" mode (Close/Adjust).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
