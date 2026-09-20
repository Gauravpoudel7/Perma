# Component: Short Mint

## Purpose
The Short Mint is a specialized flow within the Position Engine that converts a user's collateral into a Short Option position. Its primary function is to act as the bridge that transforms "capital" into "liquidity" on the Orca Whirlpool.

## User-Facing Behavior
The user selects a price range and a size. Upon confirmation, their collateral is locked, and they see their position appear in their portfolio. In the background, they have effectively become a liquidity provider for Orca.

## Dependencies
- **Position Engine**: For creating the `Position` PDA.
- **CLMM Adapter**: To execute the Orca `open_position` + `increase_liquidity_v2` CPIs.
- **Collateral Manager**: To lock the required assets.

## State & PDAs
This component leverages the `Position` and `UserCollateral` PDAs.

## Public Interface
This is implemented as a specific path within the `mint_position` instruction.

## Algorithms & Pseudocode

### Short Minting Sequence
```rust
fn execute_short_mint(user, range, size) {
    // 1. Calculate required assets based on range and size
    //    - PERMA does not quote Whirlpool math on-chain. The client supplies token_max_a/b;
    //      the handler measures the vault deltas around the CPI and locks the OBSERVED spend.
    
    // 2. Lock assets in Collateral Manager
    //    - collateral_manager.lock(user, assets);
    
    // 3. Add liquidity to Orca
    //    - clmm_adapter.add_liquidity(range, size);
    
    // 4. Initialize Position PDA
    //    - position_engine.create_position(user, SHORT, range, size);
    
    // 5. Checkpoint premium entitlement (shorts use the RANGE accumulator, not the global index)
    //    - position.entry_acc_q64 = range.acc_premium_per_short_q64;   // after poke_range, before total_short += L
}
```

## Invariants
- **Asset Backing**: A Short position cannot exist without the corresponding assets being locked in the `Collateral Manager` and deposited in the `Whirlpool`.

## Failure Modes & Errors
- **`InsufficientFunds`**: free balance does not cover `token_max_a` / `token_max_b`.
- **`SlippageExceeded`**: the observed spend breached `token_max_a` / `token_max_b`.

## Security Notes
- **Atomic Execution**: The lock and the CPI call must be in the same transaction. If the Orca call fails, the lock must be reverted.
- **Locked = observed spend, exactly.** Nothing is rounded: the handler locks precisely what the vault deltas show Orca took, so conservation holds to the unit.

## Test Cases
- **Success**: Mint short $\rightarrow$ Check `UserCollateral.locked` increased $\rightarrow$ Check Whirlpool liquidity increased.
- **Failure**: Mint short with 0 collateral $\rightarrow$ Expect `InsufficientFunds`.

## Observability & Events
- `ShortMinted { market, owner, perma_position, orca_position, tick_lower, tick_upper, liquidity, locked_a, locked_b, open_positions }`

## MVP Done Definition
- [x] Successful integration of `CollateralManager.lock` $\rightarrow$ `CLMMAdapter.add_liquidity`, atomically in `mint_position`. *(04/05)*
- [x] Required assets are **observed** from vault deltas, not quoted on-chain; the client supplies `token_max_*` slippage caps. *(04/05)*
