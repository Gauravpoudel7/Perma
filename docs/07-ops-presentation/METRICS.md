# METRICS: PERMA Performance

## Primary KPIs (MVP)

### 1. Liquidity Depth
- **Total Value Locked (TVL)**: Sum of all collateral in vaults.
- **Effective Liquidity**: Total liquidity added to Orca via Short positions.
- **Utilization Ratio**: $\frac{\text{Total Long Liquidity}}{\text{Total Short Liquidity}}$.

### 2. Volume & Activity
- **Position Count**: Total number of active Longs vs. Shorts.
- **Turnover**: Number of `mint` and `burn` operations per day.
- **Premium Volume**: Total USDC paid in streaming premiums.

### 3. Risk Metrics
- **Long coverage**: `free_b / (Σ accrued + Σ margin)` per user with open longs *(computable once component 09 lands; no Account-Value notion exists in Fair MVP)*.
- **Liquidation Rate**: Percentage of positions closed via liquidation (if implemented).

## Tracking Implementation
- **On-Chain**: Events (`ShortMinted`, `LongMinted`, `ShortBurned`, `LongBurned`, `PremiumSettled`, `Collateral*`, `MarketCreated`) are emitted for every state change.
- **Off-Chain**: The indexer aggregates these events into the PostgreSQL database to provide real-time dashboards.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
