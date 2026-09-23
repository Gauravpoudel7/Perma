# RISK DISCLOSURES: PERMA MVP

## General Disclaimer
**PERMA is a prototype. It has NOT been audited. It is deployed on a single pool for demonstration purposes. DO NOT USE PRODUCTION MAINNET RISK CAPITAL.**

## Protocol Risks

### 1. Smart Contract Risk
As an unaudited prototype, the program may contain bugs or vulnerabilities that could lead to loss of funds.

### 2. CLMM Dependency
PERMA relies on the Orca Whirlpool program. Any vulnerability or downtime in the Orca protocol directly impacts PERMA's ability to function.

### 3. Oracle Risk
PERMA's **solvency and settlement read no price**; Orca's spot tick is read only for range alignment, and Orca Whirlpool exposes no TWAP. This means there is nothing for a price manipulation to trigger — but also that a short's collateral can lose value through impermanent loss with no on-chain response.

Since P3 ([ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md)), opening a position (short or long) additionally requires a fresh, confident Pyth SOL/USD price close to the pool's own price. If that price is stale, too uncertain, or far from the pool, **new positions cannot open** until it recovers. Closing positions, settling premium and withdrawing never depend on it. The check treats devUSDC as USD 1:1, and it is a gate only — it does not value collateral, and there is still no liquidation.

### 4. Liquidity Risk
Long positions require corresponding Short liquidity. If no shorts are provided for a specific range, Longs cannot be opened.

### 5. Margin Risk
Shorts are fully collateralized by the tokens locked into Orca. Longs must hold free USDC to pay streaming premium; once [component 09](../02-mvp-components/09-risk-solvency.md) ships, a long cannot withdraw below what it owes plus a short margin horizon. **There is no liquidation in Fair MVP**: a long that cannot pay stays open with its debt standing, and the shorts in that range wait to be paid.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
