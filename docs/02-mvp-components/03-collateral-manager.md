# Component: Collateral Manager

## Purpose
The Collateral Manager handles the deposit, withdrawal, and locking of assets (SOL and USDC) used to back option positions. It ensures that users have sufficient funds to open positions and prevents withdrawals that would leave a position insolvent.

## User-Facing Behavior
Users deposit assets into their personal collateral account. When they open a Short, the manager "locks" the required funds for the Orca Whirlpool. When they open a Long, the long-mint gate ([component 09](09-risk-solvency.md)) requires free USDC to cover existing long liability plus `required_margin(L)` (`InsolventMint`).

## Dependencies
- **Position Engine**: To determine how much collateral is "locked" by active positions.
- **Risk Engine**: To verify solvency before allowing a withdrawal.
- **SPL Token Program**: For asset movement.

## State & PDAs

### UserCollateral PDA
`PDA(["collateral", market, user_pubkey])`
Tracks the balance of each asset for a specific user in a specific market.
> **Superseded by component 03.** The shipped fields are side-neutral and **SPL-only**:
> `balance_a`/`locked_a` (side A = `Market.token_mint_a` = **WSOL**, 9 dp) and
> `balance_b`/`locked_b` (side B = `token_mint_b` = devUSDC, 6 dp), matching
> `Market.vault_a`/`vault_b` so there is no mapping to get wrong.
> "SOL collateral" means **wrapped** SOL; raw lamports are never tracked, because
> the vaults and the Orca adapter are SPL end-to-end and a second representation
> of the same asset could not be conserved. See `IMPL-03-FEASIBILITY.md` Q1.

- `balance_a`: free WSOL.
- `balance_b`: free devUSDC.
- `locked_a`: WSOL committed to Short positions.
- `locked_b`: devUSDC committed to Short positions.
- `premium_owed_usdc`: **legacy** long premium liability. Written only by component 06's pre-cash long burn; since 08 nothing increases it and `settle_premium` / burn pay it down (never cleared without a transfer). Live long accrual lives on `PermaPosition.accrued_scaled`, which component 09 counts.
- `open_positions`: open **shorts** backed by `locked_*`; gates `unlock_collateral`. Component 09 adds `open_longs` alongside it.

## Public Interface

### `deposit_collateral(amount_a, amount_b)`
- **Action**: Transfers assets from user to the protocol vault and updates `UserCollateral`.

### `withdraw_collateral(amount_a, amount_b)`
- **Action**: 
    1. Calls `risk::check_withdraw_allowed` — the single withdraw seam. Free covers the request (`InsufficientFunds`); free USDC after ≥ `premium_owed_usdc + Σ (open-long accrual + margin)` (`InsolventWithdrawal`, component 09). The call site never changed.
    2. If allowed, debits free balance and transfers from the vault to the user's ATAs.
    3. Updates `UserCollateral`.

### `lock_collateral(amount_sol, amount_usdc)`
- **Action**: Moves funds from `balance` to `locked` (internal accounting). Used during Short minting.

### `unlock_collateral(amount_sol, amount_usdc)`
- **Action**: Moves funds from `locked` back to `balance`. Used during position burn.

### `debit_usdc(amount)` / `credit_usdc(amount)`
- **Action**: Moves µUSDC between a user's `usdc_balance` and a **range premium vault**. Used only by the premium settlement paths in [`08-burn-settle.md`](08-burn-settle.md).
- **Premium is USDC-only** — a short earns USDC even when its collateral is partly SOL. See [ADR-0002](../adr/ADR-0002-premium-accounting.md).
- `debit_usdc` fails with `InsufficientCollateralForLoss` if `usdc_balance` cannot cover the amount. Premium is a **senior claim**, debited before P&L.

### Range premium vault

`["range_vault", market, tick_lower_le, tick_upper_le]` — a PDA-owned USDC token account, authority `market_authority`, one per range.

Escrowed premium is held **here, not in the shared collateral vault**. Keeping it separate is what makes the vault-conservation invariant independently checkable: `range_vault.amount == premium_pool + dust` (`dust` is declared and always 0 — residue stays in `premium_pool`), while the collateral vault continues to satisfy its own reconciliation. Both are reconciled over RPC by `scripts/reconcile.mjs`.

## Algorithms & Pseudocode

### Withdrawal Solvency Check
```rust
fn withdraw_collateral(ctx, amounts) {
    // 1. Calculate prospective new balance
    // 2. risk::check_withdraw_allowed(user, amount_a, amount_b)?;
    //      free_a/free_b >= amount            else InsufficientFunds
    //      free_b - amount_b >= premium_owed + Σ(open-long accrual + margin)   else InsolventWithdrawal
    // 3. Transfer funds to user
}
```

## Invariants
- **Balance Integrity**: `total_deposited = balance + locked`.
- **Vault Reconciliation**: The sum of all `UserCollateral` balances must equal the total assets held in the protocol vaults.
- **Premium Vault Separation**: `range_vault.amount == premium_pool + dust` for every range (`dust` never written), checked independently of the collateral vault.
- **Premium Seniority**: premium is debited from **free** USDC only, never from `locked_*` (which backs someone else's Orca liquidity); if free cannot cover it the transaction fails `InsufficientCollateralForLoss`.

## Failure Modes & Errors
- **`InsufficientFunds`**: User tries to withdraw more than their balance.
- **`InsolventWithdrawal`**: Withdrawal would leave free USDC below an outstanding obligation. Since component 09: below `premium_owed_usdc + Σ (accrued premium + margin)` over the user's open longs, with the premium index projected to now.

## Security Notes
- **Vault Isolation**: Collateral is held in a protocol-controlled vault, not the user's own account, to prevent arbitrary withdrawal during an open position.
- **Re-entrancy**: All balance updates must happen before asset transfers.

## Test Cases
- **Success**: Deposit SOL/USDC and verify `UserCollateral` updates.
- **Success**: Lock funds for a short, then unlock them after burning.
- **Failure**: Attempt to withdraw more than free balance while holding a short $\rightarrow$ Expect `InsufficientFunds`. Locked collateral is unreachable by construction, so no solvency check is involved — `withdraw_free` only touches free balance (`tests/collateral.ts`).
- **Failure**: Withdraw down to the accrued-premium liability of an open long $\rightarrow$ Expect `InsolventWithdrawal` (`tests/risk-solvency.ts` R3, R7).
- **Success**: `debit_usdc` then `credit_usdc` across a range vault $\rightarrow$ Verify `range_vault.balance == premium_pool + dust` holds throughout.

## Observability & Events
- `CollateralDeposited { market, owner, amount_a, amount_b, balance_a, balance_b }`
- `CollateralWithdrawn { market, owner, amount_a, amount_b, balance_a, balance_b }`
- `CollateralLocked` / `CollateralUnlocked` (same shape)

## MVP Done Definition
- [x] `UserCollateral` PDA implemented. *(component 03)*
- [x] Deposit and Withdrawal flows operational. *(component 03)*
- [x] A solvency check is integrated into the withdrawal flow — free-balance and premium-seniority *(component 03)*; open-long accrual + horizon margin, no PnL, no TWAP *(component 09, [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md))*.
