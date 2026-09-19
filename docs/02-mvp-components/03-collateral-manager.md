# Component: Collateral Manager

## Purpose
The Collateral Manager handles the deposit, withdrawal, and locking of assets (SOL and USDC) used to back option positions. It ensures that users have sufficient funds to open positions and prevents withdrawals that would leave a position insolvent.

## User-Facing Behavior
Users deposit assets into their personal collateral account. When they open a Short, the manager "locks" the required funds for the Orca Whirlpool. When they open a Long, it verifies they have enough collateral to cover the margin requirements.

## Dependencies
- **Position Engine**: To determine how much collateral is "locked" by active positions.
- **Risk Engine**: To verify solvency before allowing a withdrawal.
- **SPL Token Program**: For asset movement.

## State & PDAs

### UserCollateral PDA
`PDA(["collateral", market, user_pubkey])`
Tracks the balance of each asset for a specific user in a specific market.
- `sol_balance`: Total SOL deposited.
- `usdc_balance`: Total USDC deposited.
- `sol_locked`: SOL currently tied up in Short positions.
- `usdc_locked`: USDC currently tied up in Short positions.

## Public Interface

### `deposit_collateral(amount_sol, amount_usdc)`
- **Action**: Transfers assets from user to the protocol vault and updates `UserCollateral`.

### `withdraw_collateral(amount_sol, amount_usdc)`
- **Action**: 
    1. Calls `RiskEngine::check_solvency()`.
    2. If solvent, transfers assets from vault to user.
    3. Updates `UserCollateral`.

### `lock_collateral(amount_sol, amount_usdc)`
- **Action**: Moves funds from `balance` to `locked` (internal accounting). Used during Short minting.

### `unlock_collateral(amount_sol, amount_usdc)`
- **Action**: Moves funds from `locked` back to `balance`. Used during position burn.

## Algorithms & Pseudocode

### Withdrawal Solvency Check
```rust
fn withdraw_collateral(ctx, amounts) {
    // 1. Calculate prospective new balance
    // 2. Call RiskEngine:
    //    if (!risk_engine.is_solvent(user, new_balance)) {
    //        return Error::InsolventWithdrawal;
    //    }
    // 3. Transfer funds to user
}
```

## Invariants
- **Balance Integrity**: `total_deposited = balance + locked`.
- **Vault Reconciliation**: The sum of all `UserCollateral` balances must equal the total assets held in the protocol vaults.

## Failure Modes & Errors
- **`InsufficientFunds`**: User tries to withdraw more than their balance.
- **`InsolventWithdrawal`**: Withdrawal would break the margin requirement for an open position.

## Security Notes
- **Vault Isolation**: Collateral is held in a protocol-controlled vault, not the user's own account, to prevent arbitrary withdrawal during an open position.
- **Re-entrancy**: All balance updates must happen before asset transfers.

## Test Cases
- **Success**: Deposit SOL/USDC and verify `UserCollateral` updates.
- **Success**: Lock funds for a short, then unlock them after burning.
- **Failure**: Attempt to withdraw all collateral while holding a large position $\rightarrow$ Expect `InsolventWithdrawal`.

## Observability & Events
- `CollateralDeposited(user, sol, usdc)`
- `CollateralWithdrawn(user, sol, usdc)`

## MVP Done Definition
- [ ] `UserCollateral` PDA implemented.
- [ ] Deposit and Withdrawal flows operational.
- [ ] Solvency check integrated into the withdrawal flow.
