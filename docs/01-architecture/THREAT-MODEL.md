# THREAT MODEL: PERMA

This document analyzes the potential attack vectors of the PERMA protocol and the corresponding mitigations implemented in the MVP.

## 1. Account & Ownership Attacks

### Spoofed Position Lists
- **Threat**: A user submits a list of positions they don't own to inflate their solvency.
- **Mitigation**: **Explicit PDA Ownership**. The program derives the `Position` PDA using the owner's pubkey: `PDA(["position", market, owner, position_id])`. It is mathematically impossible to reference a position owned by someone else.

### Duplicate Position Inflation
- **Threat**: A user references the same position multiple times in a batch call to artificially increase their balance.
- **Mitigation**: **Deterministic IDs**. Position IDs are hashed and checked for duplicates within every transaction.

## 2. Market & Price Attacks

### Tick Manipulation
- **Threat**: An attacker uses a flash loan to spike the price of the underlying pool, triggering a mass liquidation of Longs.
- **Mitigation**: **Observation Gates**. All risk-critical operations (liquidations, solvency checks) must compare the spot price against a TWAP (Time-Weighted Average Price) derived from the pool's observations. If the deviation is > X%, the transaction is rejected.

### "Free Long" Attack
- **Threat**: A user attempts to open a Long position without any corresponding Short liquidity.
- **Mitigation**: **Inventory Hard-Cap**. The `Market` PDA tracks `available_short_liquidity`. Longs are strictly rejected if `requested_long_liquidity > available_short_liquidity`.

## 3. Protocol & Logic Attacks

### Re-entrancy
- **Threat**: Using a CPI call to re-enter the PERMA program and withdraw collateral before the position is marked as `Closed`.
- **Mitigation**: **Checks-Effects-Interactions Pattern**. All internal state updates (e.g., marking a position as `Closed`) happen before any external asset transfers or CPI calls.

### Rounding Attacks
- **Threat**: Creating thousands of tiny positions to profit from rounding errors in premium calculation.
- **Mitigation**: **Protocol-Favorable Rounding**. All premiums are rounded in favor of the receiver/protocol. Minimum position sizes are enforced to make "dust attacks" unprofitable.

## 4. Operational Risks

### Admin Key Compromise
- **Threat**: An attacker steals the admin key and pauses the market or changes risk parameters.
- **Mitigation**: **Multisig Authority**. The admin key must be a Squads multisig. All critical config changes require M-of-N approval.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
