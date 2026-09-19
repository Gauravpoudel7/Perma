# INSTRUCTIONS: Program Interface

This document lists the public instructions available in the PERMA program. All instructions are implemented via the Anchor framework.

## 1. Global Administration

### `initialize_global_config`
- **Purpose**: Setup the protocol admin and allowlist.
- **Accounts**: `GlobalConfig` (Write), `Admin` (Signer).
- **Params**: `allowlisted_pools: Vec<Pubkey>`.

### `pause_market` / `unpause_market`
- **Purpose**: Emergency halt of a specific market.
- **Accounts**: `Market` (Write), `Admin` (Signer).

## 2. Collateral Management

### `deposit_collateral`
- **Purpose**: Fund the user's collateral account.
- **Accounts**: `UserCollateral` (Write), `Vault` (Write), `User` (Signer).
- **Params**: `amount_sol: u64`, `amount_usdc: u64`.

### `withdraw_collateral`
- **Purpose**: Remove funds from the protocol.
- **Accounts**: `UserCollateral` (Write), `Vault` (Write), `User` (Signer).
- **Params**: `amount_sol: u64`, `amount_usdc: u64`.
- **Guard**: Requires `RiskEngine::is_solvent()`.

## 3. Position Lifecycle

### `mint_options`
- **Purpose**: Open a new Long or Short position.
- **Accounts**: `Position` (Write), `Market` (Write), `UserCollateral` (Write), `User` (Signer), `CLMMAdapter` (Write).
- **Params**: `leg_type: Enum`, `tick_lower: i32`, `tick_upper: i32`, `size: u64`.

### `burn_options`
- **Purpose**: Close a position and settle P&L + Premium.
- **Accounts**: `Position` (Write), `UserCollateral` (Write), `Market` (Write), `User` (Signer), `CLMMAdapter` (Write).

## 4. Maintenance

### `poke_observations`
- **Purpose**: Force an update of the `GlobalPremiumIndex` and pool observations.
- **Accounts**: `GlobalPremiumIndex` (Write), `Market` (Read).
