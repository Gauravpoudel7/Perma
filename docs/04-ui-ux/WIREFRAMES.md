# WIREFRAMES: PERMA App

## Layout 1: The Trade Dashboard
- **Sidenav (Left)**: 
    - [Trade] (Active)
    - [Portfolio]
    - [Vault]
    - [Docs]
- **Main Stage (Center)**:
    - **Top Row**: SOL/USDC Price | Wallet Address | Global Status.
    - **Trade Box (Center)**:
        - Range Slider $\rightarrow$ [Tick L] ... [Tick U].
        - Size Input Field.
        - Long/Short Toggle.
        - [Open Position] Button.
    - **Right Panel**: *Descoped in the shipped MVP.* A cross-range depth map needs an
      indexer over every `RangePremiumState` PDA (component 11, not built). The one honest
      number available today — available short liquidity for the range currently selected —
      is shown inline next to the Size Input instead of as a separate mini-map.

## Layout 2: The Portfolio View
- **Sidenav (Left)**: (Same as above).
- **Main Stage (Center)**:
    - **Header**: "My Active Positions".
    - **Table**:
        - Side | Range | Size | Accrued Premium (Est.) | Status | [Close] / [Settle].
        - No P&L column: no P&L instruction exists (long closes at 0; a short's realized LP
          result is applied once, at close — see [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).
      Collateral summary lives on the Vault screen (Layout 3), not here.

## Layout 3: The Vault View
- **Sidenav (Left)**: (Same as above).
- **Main Stage (Center)**:
    - **Header**: "Asset Management".
    - **Deposit Card**: [Amount] [Token] $\rightarrow$ [Deposit].
    - **Withdraw Card**: [Amount] [Token] $\rightarrow$ [Withdraw].
    - **Asset Breakdown**: Deposited | Locked by open positions | Available to withdraw |
      **Required free USDC** (a real amount, not a "Solvency Ratio" — Fair MVP reads no price).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
