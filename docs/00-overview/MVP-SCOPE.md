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
    - `mint_options` $\rightarrow$ `burn_options` (Close/Settle).
    - Streaming premium accumulation tracked on-chain.

### 3. Financials & Risk
- **Collateral**: SOL and/or USDC deposits.
- **Solvency**: Margin-based checks on every `mint` and `withdraw` operation.
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


## Fair status — **COMPLETE** (2026-09-21)

Fair MVP components **01–11** are shipped. The release gate is **GREEN** ([`RELEASE-GATE.md`](../06-testing/RELEASE-GATE.md)): **102/102** integration tests both orders on a fresh ledger, unit/UI checks green, pause/admin + Fair-thin events included.

**What Fair proved:** Deposit → Short (real Orca liquidity) → Long (inventory-gated) → Stream premium → Settle cash; solvency (ADR-0003); emergency pause with Exit Guaranteed; thin Trade / Portfolio / Vault UI; event catalog + post-tx decode.

**What Fair deliberately is not:** multi-leg, multi-pool, liquidation, force exercise, price-aware margin, P2 charts/indexer, mainnet risk capital.

## After Fair

Protocol V1 work starts at **P1** under [`docs/09-post-mvp/`](../09-post-mvp/). That folder does **not** expand Fair scope — the P2 indexer/product UI in particular is not Fair work. Do not reopen components 01–11 unless a critical bugfix is required.

---

**⚖️ Conflict Resolution:** In any discrepancy between this document and other technical specs, the **PRD Part A** wins.
