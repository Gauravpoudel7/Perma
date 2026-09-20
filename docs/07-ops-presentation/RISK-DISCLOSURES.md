# RISK DISCLOSURES: PERMA MVP

## General Disclaimer
**PERMA is a prototype. It has NOT been audited. It is deployed on a single pool for demonstration purposes. DO NOT USE PRODUCTION MAINNET RISK CAPITAL.**

## Protocol Risks

### 1. Smart Contract Risk
As an unaudited prototype, the program may contain bugs or vulnerabilities that could lead to loss of funds.

### 2. CLMM Dependency
PERMA relies on the Orca Whirlpool program. Any vulnerability or downtime in the Orca protocol directly impacts PERMA's ability to function.

### 3. Oracle Risk
PERMA performs **no price-based risk check** in Fair MVP; Orca's spot tick is read only for range alignment, and Orca Whirlpool exposes no TWAP. This means there is nothing for a price manipulation to trigger — but also that a short's collateral can lose value through impermanent loss with no on-chain response.

### 4. Liquidity Risk
Long positions require corresponding Short liquidity. If no shorts are provided for a specific range, Longs cannot be opened.

### 5. Margin Risk
Shorts are fully collateralized by the tokens locked into Orca. Longs must hold free USDC to pay streaming premium; once [component 09](../02-mvp-components/09-risk-solvency.md) ships, a long cannot withdraw below what it owes plus a short margin horizon. **There is no liquidation in Fair MVP**: a long that cannot pay stays open with its debt standing, and the shorts in that range wait to be paid.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
