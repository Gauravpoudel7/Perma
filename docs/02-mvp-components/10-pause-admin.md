# Component: Pause Admin

## Purpose
The Pause Admin provides the "emergency brake" for the protocol. It allows the admin to halt all trading and minting activities in the event of a critical bug, extreme market volatility, or an active exploit.

## User-Facing Behavior
When the market is paused, the "Trade" buttons in the UI are disabled, and a banner appears: "Market Currently Paused by Admin". Users can still close/burn their positions (to allow exit), but cannot open new ones.

## Dependencies
- **Market**: The target account whose `is_paused` flag is toggled.
- **GlobalConfig**: To verify admin authority.

## State & PDAs
- **Market PDA**: Contains the `is_paused` boolean.
- **GlobalConfig PDA**: Contains the `admin_pubkey`.

## Public Interface

### `pause_market(market_address)`
- **Caller**: Admin.
- **Action**: Sets `Market.is_paused = true`.

### `unpause_market(market_address)`
- **Caller**: Admin.
- **Action**: Sets `Market.is_paused = false`.

### `pause_global()`
- **Caller**: Admin.
- **Action**: Sets a global flag in `GlobalConfig` to pause all markets.

## Algorithms & Pseudocode

### Pause Guard
```rust
fn mint_options(ctx) {
    if (ctx.market.is_paused || ctx.global_config.is_paused) {
        return Error::MarketPaused;
    }
    // ... proceed with minting
}
```

## Invariants
- **Exit Guaranteed**: Pausing should block new risk (mints), but should generally allow the closing of existing risk (burns), unless the protocol is in a total "freeze" state.

## Failure Modes & Errors
- **`MarketPaused`**: Operation rejected because the admin has paused the market.
- **`Unauthorized`**: Only the admin can call pause/unpause.

## Security Notes
- **Admin Key Custody**: The admin key is a single point of failure. It must be a multisig (e.g., Squads on Solana).
- **Transparency**: All pause/unpause events must be emitted on-chain for public tracking.

## Test Cases
- **Success**: Admin pauses market $\rightarrow$ `mint_options` fails $\rightarrow$ `burn_options` succeeds.
- **Success**: Admin unpauses market $\rightarrow$ `mint_options` succeeds.
- **Failure**: Non-admin attempts to pause $\rightarrow$ Expect `Unauthorized`.

## Observability & Events
- `MarketPaused(market, admin)`
- `MarketUnpaused(market, admin)`

## MVP Done Definition
- [ ] `is_paused` flag added to `Market` PDA.
- [ ] `pause_market` / `unpause_market` instructions implemented.
- [ ] Pause guards integrated into all risk-increasing instructions.
