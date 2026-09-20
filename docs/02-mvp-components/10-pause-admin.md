# Component: Pause Admin

> **Status: NOT IMPLEMENTED.** `Market.is_paused` exists and every user instruction — deposit, withdraw, lock, unlock, `mint_position`, `settle_premium`, **and `burn_position`** — checks it. But no instruction writes it: it is `false` from `create_market` onward. Everything under Public Interface below is specification. Note the live guard set contradicts the "Exit Guaranteed" invariant — a paused market today would also block burns and settles; resolving that is this component's first decision.

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
fn mint_position(ctx) {
    if (ctx.market.is_paused) {              // no GlobalConfig.is_paused exists; pause_global is spec only
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
- **Success**: Admin pauses market $\rightarrow$ `mint_position` fails $\rightarrow$ `burn_position` succeeds.
- **Success**: Admin unpauses market $\rightarrow$ `mint_position` succeeds.
- **Failure**: Non-admin attempts to pause $\rightarrow$ Expect `Unauthorized`.

## Observability & Events
- `MarketPaused(market, admin)`
- `MarketUnpaused(market, admin)`

## MVP Done Definition
- [x] `is_paused` flag added to `Market` PDA *(component 02; always `false`)*.
- [ ] `pause_market` / `unpause_market` instructions implemented.
- [x] Pause guards integrated into all user instructions *(components 03–08 — including burn/settle, which this spec says should stay open; decide before shipping the setter)*.
