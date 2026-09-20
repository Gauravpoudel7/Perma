# HANDOFF: PERMA MVP

## Current State
Components 01–08 are shipped and verified on a local validator with Orca cloned in (66 integration + 54 unit tests; reports under `docs/audits/IMPL-*`). The docs tree was re-synced to the live program before component 09 ([`DOCS-SYNC-AUDIT-09.md`](audits/DOCS-SYNC-AUDIT-09.md)). The system proves the feasibility of perpetual options using Solana's concentrated liquidity.

## Critical Path for Day-1 Implementation
1. ~~**Step 1: Orca Adapter**~~ **Done (01/01B).** Implement the `CLMM Adapter` to allow `increase_liquidity_v2` and `decrease_liquidity_v2` CPIs.
2. ~~**Step 2: Collateral & Markets**~~ **Done (02/03).** Setup the `GlobalConfig` and `Market` PDAs.
3. ~~**Step 3: Short Mint**~~ **Done (04/05).** Enable users to lock collateral and add liquidity to Orca.
4. ~~**Step 4: Long Mint**~~ **Done (06).** Implement the inventory check and long position creation.
5. ~~**Step 5: Premium & Burn**~~ **Done (07/08).** Index-based premium accumulator; cash settlement in `burn_position` and `settle_premium`.
6. **Step 6: Solvency** — *next*. Long-liability + horizon margin on withdraw and long mint, no price input ([`09-risk-solvency.md`](02-mvp-components/09-risk-solvency.md), [ADR-0003](adr/ADR-0003-fair-mvp-risk-model.md)).

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
