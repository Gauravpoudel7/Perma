# ONCHAIN ARCHITECTURE: PERMA Program

## Program Structure
The PERMA program is built using the **Anchor Framework**. It is structured as a set of modular logic units that interact via a central `Market` coordinator.

## Account Layout

### 1. GlobalConfig
- **Admin**: `Pubkey` (Authority for config/pausing).
- **AllowlistedPools**: `Vec<Pubkey>` (Approved Whirlpools).
- **GlobalPause**: `bool`.

### 2. Market
- **Pool**: `Pubkey` (The underlying Orca Whirlpool).
- **TotalShortLiquidity**: `u64` (Inventory for Longs).
- **PremiumRate**: `u64` (Index growth per slot).
- **IsPaused**: `bool`.

### 3. UserCollateral
- **Owner**: `Pubkey`.
- **SolBalance / UsdcBalance**: `u64`.
- **SolLocked / UsdcLocked**: `u64`.

### 4. Position
- **Owner**: `Pubkey`.
- **LegType**: `Enum { Long, Short }`.
- **TickLower / TickUpper**: `i32`.
- **Size**: `u64`.
- **EntryIndex**: `u64`.
- **Status**: `Enum { Open, Closed, Liquidated }`.

## CPI Flow: The Orca Interaction
The most critical path in the program is the `Position Engine` $\rightarrow$ `CLMM Adapter` $\rightarrow$ `Orca Whirlpool` flow.

1. **Validation**: PERMA verifies the user has enough collateral.
2. **Transfer**: PERMA transfers SOL/USDC to the Whirlpool account.
3. **Instruction**: PERMA calls `whirlpool.increase_position(...)` with the specified tick range.
4. **Confirmation**: PERMA verifies the resulting Whirlpool position account matches the expected liquidity increase.

## Memory & Compute Budget (CU)
To ensure transactions fit within Solana's limits:
- **Tick Arrays**: The program optimizes the number of tick arrays passed to the adapter.
- **Batching**: Multi-leg positions (deferred to V1) will require a multi-instruction transaction (IX) flow.
- **PDAs**: Minimal seed lengths are used to reduce hashing costs.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
