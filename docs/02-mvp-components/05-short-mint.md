# Component: Short Mint

## Purpose
The Short Mint is a specialized flow within the Position Engine that converts a user's collateral into a Short Option position. Its primary function is to act as the bridge that transforms "capital" into "liquidity" on the Orca Whirlpool.

## User-Facing Behavior
The user selects a price range and a size. Upon confirmation, their collateral is locked, and they see their position appear in their portfolio. In the background, they have effectively become a liquidity provider for Orca.

## Dependencies
- **Position Engine**: For creating the `Position` PDA.
- **CLMM Adapter**: To execute the `increase_position` call on Orca.
- **Collateral Manager**: To lock the required assets.

## State & PDAs
This component leverages the `Position` and `UserCollateral` PDAs.

## Public Interface
This is implemented as a specific path within the `mint_options` instruction.

## Algorithms & Pseudocode

### Short Minting Sequence
```rust
fn execute_short_mint(user, range, size) {
    // 1. Calculate required assets based on range and size
    //    - assets = clmm_adapter.calculate_required_assets(range, size);
    
    // 2. Lock assets in Collateral Manager
    //    - collateral_manager.lock(user, assets);
    
    // 3. Add liquidity to Orca
    //    - clmm_adapter.add_liquidity(range, size);
    
    // 4. Initialize Position PDA
    //    - position_engine.create_position(user, SHORT, range, size);
    
    // 5. Set entry premium index
    //    - position.entry_index = premium_engine.get_current_index();
}
```

## Invariants
- **Asset Backing**: A Short position cannot exist without the corresponding assets being locked in the `Collateral Manager` and deposited in the `Whirlpool`.

## Failure Modes & Errors
- **`InsufficientCollateral`**: User does not have enough SOL/USDC to cover the requested size.
- **`SlippageError`**: The assets required for the range changed significantly during the transaction.

## Security Notes
- **Atomic Execution**: The lock and the CPI call must be in the same transaction. If the Orca call fails, the lock must be reverted.
- **Rounding**: Rounding must always favor the protocol when locking assets.

## Test Cases
- **Success**: Mint short $\rightarrow$ Check `UserCollateral.locked` increased $\rightarrow$ Check Whirlpool liquidity increased.
- **Failure**: Mint short with 0 collateral $\rightarrow$ Expect `InsufficientCollateral`.

## Observability & Events
- `ShortMinted(user, range, size, assets_locked)`

## MVP Done Definition
- [ ] Successful integration of `CollateralManager.lock` $\rightarrow$ `CLMMAdapter.add_liquidity`.
- [ ] Correct calculation of required assets for a given range and size.
