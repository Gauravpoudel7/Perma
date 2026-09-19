# TEST PLAN: Fair MVP

## Core Test Suite

### Suite 1: Collateral Flow
- [ ] **T1.1**: Deposit SOL/USDC $\rightarrow$ Verify `UserCollateral` balance.
- [ ] **T1.2**: Withdraw valid amount $\rightarrow$ Verify assets returned.
- [ ] **T1.3**: Withdraw excessive amount $\rightarrow$ Expect `InsufficientFunds`.

### Suite 2: Short Position Lifecycle
- [ ] **T2.1**: Mint Short $\rightarrow$ Verify `UserCollateral.locked` increases.
- [ ] **T2.2**: Mint Short $\rightarrow$ Verify Orca Whirlpool liquidity increases.
- [ ] **T2.3**: Burn Short $\rightarrow$ Verify Orca liquidity removed $\rightarrow$ Assets unlocked.

### Suite 3: Long Position Lifecycle
- [ ] **T3.1**: Mint Long (Short exists) $\rightarrow$ Success.
- [ ] **T3.2**: Mint Long (No Short exists) $\rightarrow$ Expect `NoShortInventory`.
- [ ] **T3.3**: Mint Long $\rightarrow$ Verify `Market.available_short_liquidity` decreases.

### Suite 4: Premium & Settlement
- [ ] **T4.1**: Wait $N$ slots $\rightarrow$ Verify `GlobalPremiumIndex` increases.
- [ ] **T4.2**: Burn position $\rightarrow$ Verify P&L + Premium correctly added to collateral.

### Suite 5: Risk & Solvency
- [ ] **T5.1**: Open position $\rightarrow$ Withdraw collateral to the limit $\rightarrow$ Success.
- [ ] **T5.2**: Withdraw one more unit $\rightarrow$ Expect `InsolventWithdrawal`.
- [ ] **T5.3**: Market price move $\rightarrow$ Verify solvency status updates.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
