# HANDOFF: PERMA MVP

## Current State
The PERMA MVP documentation pack is complete. The system is designed to prove the feasibility of perpetual options using Solana's concentrated liquidity.

## Critical Path for Day-1 Implementation
1. **Step 1: Orca Adapter**. Implement the `CLMM Adapter` to allow `increase_position` and `decrease_position` calls.
2. **Step 2: Collateral & Markets**. Setup the `GlobalConfig` and `Market` PDAs.
3. **Step 3: Short Mint**. Enable users to lock collateral and add liquidity to Orca.
4. **Step 4: Long Mint**. Implement the inventory check and long position creation.
5. **Step 5: Premium & Burn**. Implement the index-based premium accumulator and the settlement logic in `burn_options`.
6. **Step 6: Solvency**. Integrate the `Risk Engine` into all mint/withdraw calls.

## Demo Day Checklist
- [ ] All `docs/06-testing/RELEASE-GATE.md` checks passed.
- [ ] `E2E-DEMO-SCRIPT.md` practiced and verified on Devnet.
- [ ] Frontend "Portfolio" and "Trade" views operational.
- [ ] Presentation deck aligns with `PRESENTATION-BRIEF.md`.

## Future Roadmap (Day-2+)
- **Multi-Leg**: Implement spreads and straddles.
- **Permissionless Factory**: Allow users to create markets for any Whirlpool.
- **Liquidation/Force-Exercise**: Implement the stretch goals for risk management.
- **Mainnet Deployment**: Conduct a professional audit before moving to mainnet.
