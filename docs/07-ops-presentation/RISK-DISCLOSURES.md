# RISK DISCLOSURES: PERMA MVP

## General Disclaimer
**PERMA is a prototype. It has NOT been audited. It is deployed on a single pool for demonstration purposes. DO NOT USE PRODUCTION MAINNET RISK CAPITAL.**

## Protocol Risks

### 1. Smart Contract Risk
As an unaudited prototype, the program may contain bugs or vulnerabilities that could lead to loss of funds.

### 2. CLMM Dependency
PERMA relies on the Orca Whirlpool program. Any vulnerability or downtime in the Orca protocol directly impacts PERMA's ability to function.

### 3. Oracle Risk
While PERMA uses pool observations for risk checks, extreme volatility or manipulation of the underlying pool could lead to incorrect solvency calculations or failed transactions.

### 4. Liquidity Risk
Long positions require corresponding Short liquidity. If no shorts are provided for a specific range, Longs cannot be opened.

### 5. Margin Risk
Users are subject to solvency requirements. If a position's value drops below the required margin, the position may be subject to liquidation (if the stretch feature is implemented).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
