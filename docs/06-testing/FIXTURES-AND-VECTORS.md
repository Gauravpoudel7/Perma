# FIXTURES AND VECTORS: Economic Baseline

## 1. Premium Vectors
- **Scenario**: Position size 100 units, Rate 10 bps per 100 slots.
- **Input**: $\Delta \text{Index} = 10$.
- **Expected**: $\text{Premium} = 10 \times 100 \times 0.001 = 1 \text{ unit}$.

## 2. P&L Vectors (Short)
- **Scenario**: Short at range [180, 220].
- **Case A (ITM)**: Price moves to 250. $\rightarrow$ Profit = (Current - Upper) * size.
- **Case B (OTM)**: Price moves to 150. $\rightarrow$ Loss = (Lower - Current) * size.

## 3. Solvency Vectors
- **Scenario**: Collateral $1000, Margin Requirement $200.
- **Case A**: P&L +$100 $\rightarrow$ Account Value $1100 $\rightarrow$ Solvent.
- **Case B**: P&L -$900 $\rightarrow$ Account Value $100 $\rightarrow$ Insolvent.

## 4. Orca Liquidity Vectors
- **Scenario**: Range [180, 220], Size 1.
- **Expected Assets**: $\text{SOL} = X, \text{USDC} = Y$ (Derived from Whirlpool math).

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
