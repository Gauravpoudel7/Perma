# Component: Position Engine (1-Leg)

## Purpose
The Position Engine is the core state machine for PERMA options. It manages the creation, tracking, and closing of individual option legs. In the MVP, it is restricted to 1-leg positions (single Long or single Short).

## User-Facing Behavior
When a user "Trades", the Position Engine creates a `Position` account. It coordinates with the `CLMM Adapter` to add/remove liquidity for shorts and with the `Premium Engine` to track the cost of longs.

## Dependencies
- **CLMM Adapter**: To execute the physical liquidity changes on Orca.
- **Collateral Manager**: To lock/unlock funds.
- **Premium Engine**: To initialize premium tracking.
- **Risk Engine**: To validate the minting of a position.

## State & PDAs

### Position PDA
`PDA(["position", market, owner, position_id])`
- `leg_type`: Long or Short.
- `tick_lower`: The lower boundary of the option.
- `tick_upper`: The upper boundary of the option.
- `liquidity_size`: The amount of liquidity backing the position.
- `entry_index`: The Global Premium Index at the time of creation.
- `status`: Open, Closed, or Liquidated.

## Public Interface

### `mint_position(leg_type, tick_lower, tick_upper, size)`
- **Action**:
    1. If SHORT: Lock collateral $\rightarrow$ Adapter `add_liquidity`.
    2. If LONG: Verify Short inventory $\rightarrow$ Check solvency.
    3. Create `Position` PDA.
    4. Initialize premium state.

### `burn_position()`
- **Action**:
    1. If SHORT: Adapter `remove_liquidity` $\rightarrow$ Unlock collateral.
    2. Calculate final P&L + Premium.
    3. Settle funds to `Collateral Manager`.
    4. Mark position as `Closed`.

## Algorithms & Pseudocode

### Minting Logic
```rust
fn mint_position(ctx, leg, range, size) {
    if (leg == SHORT) {
        collateral_manager.lock(range.required_assets());
        clmm_adapter.add_liquidity(range, size);
    } else if (leg == LONG) {
        if (!market.has_available_short_liquidity(range, size)) {
            return Error::NoShortInventory;
        }
        risk_engine.verify_solvency(user, size);
    }
    position_account.init(leg, range, size, premium_engine.current_index());
}
```

## Invariants
- **Inventory Rule**: $\text{Total Long Liquidity} \le \text{Total Short Liquidity}$ for any given range.
- **Atomic Closure**: A position cannot be closed without settling its premium and P&L.

## Failure Modes & Errors
- **`NoShortInventory`**: Attempting to go long in a range where no short liquidity has been provided.
- **`InvalidRange`**: Ticks are not valid or not within pool limits.
- **`PositionAlreadyClosed`**: Attempting to burn a position that is already closed.

## Security Notes
- **Ownership Proof**: Every operation on a `Position` account must verify the `owner` pubkey.
- **Anti-Spoofing**: The `position_id` is deterministically derived to prevent duplicate position inflation.

## Test Cases
- **Success**: Mint a Short $\rightarrow$ Verify Orca liquidity increase.
- **Success**: Mint a Long $\rightarrow$ Verify it succeeds when a Short exists.
- **Failure**: Mint a Long $\rightarrow$ Verify it fails when no Short exists.
- **Success**: Burn a Short $\rightarrow$ Verify assets return to collateral.

## Observability & Events
- `PositionMinted(owner, leg, range, size)`
- `PositionBurned(owner, leg, pnl, premium)`

## MVP Done Definition
- [ ] `Position` PDA implemented.
- [ ] `mint_position` logic for Long/Short operational.
- [ ] `burn_position` logic correctly triggers liquidity removal and settlement.
- [ ] Long-inventory check strictly enforced.
