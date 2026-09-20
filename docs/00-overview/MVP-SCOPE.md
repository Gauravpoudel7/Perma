# MVP SCOPE: The "Fair" Specification

This document defines the absolute boundaries of the PERMA Fair MVP. Any feature not listed here is considered **Out of Scope** for the initial ship and is deferred to Protocol V1.

## 🎯 Primary Goal
To prove, on-chain, that Solana concentrated liquidity can power a complete perpetual option lifecycle: **Deposit → Short (Add Liquidity) → Long (Utilize Liquidity) → Stream Premium → Settle.**

## ✅ In-Scope (Non-Negotiables)

### 1. Infrastructure
- **Chain**: Solana Devnet (Primary).
- **Underlying CLMM**: Orca Whirlpool ONLY.
- **Market**: Exactly one allowlisted SOL/USDC pool.
- **Admin**: Simple admin authority for global config and market pausing.

### 2. Position Mechanics
- **Legs**: 1-leg positions only (single Long or single Short).
- **Shorts**: Must actually call Orca CPI to add liquidity to the Whirlpool.
- **Longs**: Can only be opened if corresponding short liquidity exists in that range.
- **Lifecycle**: 
    - `mint_position` $\rightarrow$ `burn_position` (Close/Settle).
    - Streaming premium accumulation tracked on-chain.

### 3. Financials & Risk
- **Collateral**: SOL and/or USDC deposits.
- **Solvency**: on every `withdraw_collateral` and long `mint_position`, free USDC must cover the user's open-long premium liability plus a horizon margin — no price input ([component 09](../02-mvp-components/09-risk-solvency.md), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).
- **Settlement**: P&L + Premium settled into collateral balances upon burning the position.

### 4. User Experience
- **Wallet**: Solana Wallet Adapter integration.
- **Core Flows**:
    - Deposit/Withdraw Collateral.
    - Open Short (Define range $\rightarrow$ Add Liquidity).
    - Open Long (Check inventory $\rightarrow$ Mint position).
    - Portfolio View (Current positions, premium owed/earned, solvency).
- **Banner**: Persistent "Prototype. Not audited. Single pool. Not production." warning.

## 🛠️ Stretch Goals (Pick ONE)
The team may implement **at most one** of the following:
- **Liquidation**: Allow third parties to close insolvent accounts for a bonus.
- **Force Exercise**: Allow sellers to force-exercise out-of-range longs.

## ❌ Out of Scope (Phase 2+)
- **Multi-leg Positions**: Spreads, Straddles, Iron Condors (Max 1 leg for MVP).
- **Permissionless Factory**: Ability for users to create markets for any pool.
- **Multi-CLMM Support**: Raydium or other AMM adapters.
- **Protocol Token/DAO**: Governance tokens or vault-based yield sharing.
- **Advanced Indexing**: Sophisticated historical data analytics (minimal RPC cache is OK).
- **Mainnet Risk Capital**: No production-grade fund management.

---

**⚖️ Conflict Resolution:** In any discrepancy between this document and other technical specs, the **PRD Part A** wins.
