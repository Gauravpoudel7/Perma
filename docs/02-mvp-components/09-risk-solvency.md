# Component: Risk & Solvency

## Purpose
The Risk engine is the "guardian" of the protocol. It ensures that every action (minting, withdrawing, or maintaining a position) is backed by sufficient collateral to prevent protocol-level bad debt.

## User-Facing Behavior
When a user tries to withdraw funds or open a large position, they may see an "Insolvent" error. The UI provides a "Distance to Liquidation" metric to warn them when their collateral is getting dangerously low.

## Dependencies
- **Collateral Manager**: To read current balances.
- **Position Engine**: To read active positions and their current value.
- **CLMM Adapter**: To get the current market price for P&L valuation.

## State & PDAs
The risk engine is a set of logic functions that operate on `UserCollateral` and `Position` PDAs.

## Public Interface

### `check_solvency(user)`
- **Returns**: `bool` (True if solvent).
- **Logic**: `UserValue >= RequiredCollateral`.

### `calculate_pnl(position, current_tick)`
- **Returns**: `amount` (Profit or Loss).
- **Logic**: Calculates the intrinsic value of the option based on the current tick relative to the position's range.

### `get_required_collateral(user)`
- **Returns**: `amount`.
- **Logic**: Sum of margin requirements for all open positions.

## Algorithms & Pseudocode

### Solvency Calculation
```rust
fn is_solvent(user) {
    let collateral = collateral_manager.get_total_balance(user);
    let unrealized_pnl = 0;
    
    for pos in user.positions {
        unrealized_pnl += risk_engine.calculate_pnl(pos, clmm_adapter.get_current_tick());
    }
    
    let account_value = collateral + unrealized_pnl;
    let required = risk_engine.get_required_collateral(user);
    
    return account_value >= required;
}
```

## Invariants
- **No Under-Collateralized Mint**: A user can never open a position that makes them immediately insolvent.
- **Conservative Valuation**: P&L is calculated using the most conservative price between the spot and the TWAP.

## Failure Modes & Errors
- **`InsolventWithdrawal`**: Withdrawal would break the solvency invariant.
- **`InsolventMint`**: Minting the requested size would exceed the user's buying power.

## Security Notes
- **Price Manipulation**: The risk engine must not rely on a single tick. It must use `clmm_adapter.get_observations()` to ensure the price isn't being manipulated in a single block to trigger a false insolvency.
- **Rounding**: Margin requirements are always rounded UP.

## Test Cases
- **Success**: User with $1000 collateral opens a small position $\rightarrow$ `is_solvent` = true.
- **Failure**: User with $10 collateral attempts to open a $1000 position $\rightarrow$ `is_solvent` = false.
- **Success**: Market price moves significantly $\rightarrow$ Verify `calculate_pnl` updates and reflects in `is_solvent`.

## Observability & Events
- `SolvencyCheckFailed(user, reason)`

## MVP Done Definition
- [ ] `calculate_pnl` logic implemented for 1-leg positions.
- [ ] `check_solvency` integrated into `mint_options` and `withdraw_collateral`.
- [ ] Margin requirements defined and consistently applied.
