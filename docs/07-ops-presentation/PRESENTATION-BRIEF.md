# PRESENTATION BRIEF: PERMA MVP

## Goal
Convince the judges that PERMA is a professional-grade volatility primitive that solves a real liquidity problem on Solana.

## Narrative Arc
1. **The Hook**: Options are essential but broken. Expiries and fragmented liquidity are the bottlenecks.
2. **The Solution**: PERMA. Perpetual options where the "primitive" is a Concentrated Liquidity position.
3. **The "Magic"**: "When I open a short, I'm not just betting; I'm adding real liquidity to Orca. When Alice goes long, she's utilizing my liquidity. It's a symbiotic loop."
4. **The Demo**: (Follow `E2E-DEMO-SCRIPT.md`).
5. **The Vision**: From 1-leg SOL/USDC $\rightarrow$ 2-4 legs, spreads/straddles $\rightarrow$ Permissionless factory.

## Key Talking Points
- **Not a Toy**: Emphasize that every short is real Orca liquidity, every premium payment is a real USDC transfer into an on-chain escrow, and the "Institutional Precision" design.
- **Real-World Impact**: Explain how PERMA deepens liquidity for the underlying CLMM (Orca).
- **Risk Management**: Highlight the on-chain inventory gate (`NoShortInventory`), the conservation identities reconciled from outside the program, and the honest boundary — no liquidation, no price oracle in Fair MVP ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). Do **not** claim TWAP checks or a pause mechanism; neither exists.

## Visual Aids
- **Architecture Diagram**: Show the flow from User $\rightarrow$ PERMA $\rightarrow$ Orca.
- **Portfolio View**: Demonstrate the real-time premium accrual.
- **Explorer Proof**: Show the actual `increaseLiquidityV2` CPI into Orca Whirlpool on the blockchain.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
