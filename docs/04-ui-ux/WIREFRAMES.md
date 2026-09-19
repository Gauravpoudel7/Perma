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
    - **Right Panel**: "Market Depth" (Mini-map of available short liquidity).

## Layout 2: The Portfolio View
- **Sidenav (Left)**: (Same as above).
- **Main Stage (Center)**:
    - **Header**: "My Active Positions".
    - **Table**: 
        - ID | Type | Range | P&L | Premium | [Close].
    - **Bottom Summary**: 
        - Total Collateral | Locked | Available | Solvency Ratio.

## Layout 3: The Vault View
- **Sidenav (Left)**: (Same as above).
- **Main Stage (Center)**:
    - **Header**: "Asset Management".
    - **Deposit Card**: [Amount] [Token] $\rightarrow$ [Deposit].
    - **Withdraw Card**: [Amount] [Token] $\rightarrow$ [Withdraw].
    - **Asset Breakdown**: SOL: X.XX | USDC: Y.YY.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
