# Component: Burn & Settle

## Purpose
The Burn & Settle component handles the graceful closure of an option position. It is responsible for calculating the final economic outcome (P&L + Premium) and redistributing assets back to the users' collateral accounts.

## User-Facing Behavior
The user clicks "Close Position". They see a preview of the settlement: their P&L (based on current price vs range) and the accumulated premium. Once confirmed, the position disappears, and their collateral balance is updated.

## Dependencies
- **CLMM Adapter**: To remove liquidity for Shorts.
- **Premium Engine**: To calculate the final streaming premium.
- **Collateral Manager**: To update final balances.
- **Position Engine**: To mark the position as `Closed`.

## State & PDAs
Interacts with `Position`, `UserCollateral`, and `GlobalPremiumIndex` PDAs.

## Public Interface
Implemented as the `burn_options` instruction.

## Algorithms & Pseudocode

### Settlement Flow
```rust
fn burn_options(ctx, position) {
    // 1. Trigger Premium Index update
    premium_engine.update_index();
    
    // 2. Calculate Premium
    let premium = premium_engine.calculate_premium(
        position.entry_index, 
        premium_engine.current_index(), 
        position.size
    );
    
    // 3. Calculate P&L (Market Price vs Position Range)
    let pnl = risk_engine.calculate_pnl(position, clmm_adapter.get_current_tick());
    
    // 4. If SHORT:
    //    - clmm_adapter.remove_liquidity(position.range, position.size);
    //    - collateral_manager.unlock(position.assets);
    
    // 5. Final Settlement:
    //    - if (position.leg == SHORT) {
    //        collateral_manager.add_funds(user, premium + pnl);
    //      } else {
    //        collateral_manager.subtract_funds(user, premium + pnl);
    //      }
    
    // 6. Mark position.status = Closed;
}
```

## Invariants
- **Zero Sum**: For every long that pays premium, a short (or the protocol) must receive it.
- **Liquidity Restore**: A Short cannot be closed without the underlying Whirlpool liquidity being removed.

## Failure Modes & Errors
- **`PositionAlreadyClosed`**: Attempting to settle a position that has already been burned.
- **`InsufficientCollateralForLoss`**: A Long position's loss + premium exceeds their available collateral (should be handled by liquidation, but must be checked here).

## Security Notes
- **Atomic Settlement**: The removal of liquidity and the update of collateral must happen in one transaction to prevent users from "closing" but keeping the assets.
- **Precision**: All P&L calculations must use the same fixed-point precision as the `CLMM Adapter`.

## Test Cases
- **Success**: Burn Short $\rightarrow$ Verify Whirlpool liquidity decreased $\rightarrow$ Verify collateral increased by (Premium + P&L).
- **Success**: Burn Long $\rightarrow$ Verify collateral decreased by (Premium + P&L).
- **Failure**: Burn position $\rightarrow$ Trigger `CLMMAdapter` failure $\rightarrow$ Verify position remains `Open`.

## Observability & Events
- `PositionBurned(owner, leg, pnl, premium, total_settlement)`

## MVP Done Definition
- [ ] `burn_options` instruction fully implemented.
- [ ] Integration with `CLMM Adapter` for liquidity removal.
- [ ] Correct P&L and Premium calculation based on `current_tick`.
