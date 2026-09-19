# Component: Factory (Allowlisted Market)

## Purpose
The Factory is responsible for the lifecycle of PERMA Markets. In the MVP, it restricts market creation to a single, allowlisted SOL/USDC Orca Whirlpool to minimize risk and complexity.

## User-Facing Behavior
For the MVP, the market is pre-created by the operator. Users do not interact with the Factory directly; they interact with the existing `Market` account.

## Dependencies
- **GlobalConfig**: For admin authority and allowlist definitions.
- **Market**: The target account being created.

## State & PDAs

### Market PDA
`PDA(["market", pool_address])`
Stores the configuration for a specific pool, including the allowlist status and risk parameters.

### GlobalConfig PDA
`PDA(["global_config"])`
Stores the admin pubkey and the list of approved `pool_addresses`.

## Public Interface

### `initialize_global_config()`
- **Caller**: Admin.
- **Action**: Sets the admin key and initial parameters.

### `create_market(pool_address)`
- **Caller**: Admin.
- **Action**: 
    1. Verifies `pool_address` is in the allowlist.
    2. Initializes the `Market` PDA.
    3. Sets up initial risk parameters (e.g., max position size).

## Algorithms & Pseudocode

### Market Creation Flow
```rust
fn create_market(ctx, pool_address) {
    // 1. Check if pool_address is in GlobalConfig.allowlist
    // 2. Check if Market PDA already exists
    // 3. Initialize Market account:
    //    - pool = pool_address
    //    - is_paused = false
    //    - risk_params = default_params
    // 4. Emit MarketCreated event
}
```

## Invariants
- **Uniqueness**: Only one `Market` account can exist per `pool_address`.
- **Authorization**: Only the `GlobalConfig` admin can call `create_market`.

## Failure Modes & Errors
- **`PoolNotAllowlisted`**: The requested pool is not approved for PERMA.
- **`MarketAlreadyExists`**: Market account already initialized.
- **`Unauthorized`**: Caller is not the admin.

## Security Notes
- **Admin Key Security**: The admin key should be a multisig for any mainnet-like demo.
- **Strict Allowlist**: No "dynamic" allowlisting in MVP; it must be a hard-coded or admin-set list.

## Test Cases
- **Success**: Admin creates the SOL/USDC market.
- **Failure**: Non-admin attempts to create a market $\rightarrow$ Expect `Unauthorized`.
- **Failure**: Admin attempts to create a market for an unallowlisted pool $\rightarrow$ Expect `PoolNotAllowlisted`.

## Observability & Events
- `MarketCreated(pool_address, admin)`

## MVP Done Definition
- [ ] `GlobalConfig` PDA implemented and initialized.
- [ ] `create_market` successfully initializes a `Market` PDA for an allowlisted pool.
- [ ] Admin authorization is strictly enforced.
