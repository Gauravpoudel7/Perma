# Component: Premium Engine

## Purpose
The Premium Engine calculates and tracks the "cost of carry" for perpetual options. Since there is no expiry, the long party pays a streaming premium to the short party. The engine uses an accumulator (index) to avoid updating every position account every second.

## User-Facing Behavior
In the UI, the user sees their "Premium Owed" (for Longs) or "Premium Earned" (for Shorts) increasing in real-time. This amount is added to the P&L when the position is closed.

## Dependencies
- **Position Engine**: To get the `entry_index` of a position.
- **Market**: To define the premium rate for the pool.

## State & PDAs

### GlobalPremiumIndex PDA
`PDA(["premium_index", market])`
- `current_index`: A monotonically increasing value.
- `last_update_slot`: The slot of the last update.
- `premium_rate`: The rate at which the index increases (defined by the market).

## Public Interface

### `update_index()`
- **Action**: Increments `current_index` based on the time elapsed since `last_update_slot`.
- **Caller**: Can be called by any user (incentivized by a small fee) or automatically by the `mint/burn` flows.

### `calculate_premium(entry_index, current_index, size)`
- **Calculation**: $\text{Premium} = (\text{current\_index} - \text{entry\_index}) \times \text{size} \times \text{multiplier}$.

## Algorithms & Pseudocode

### Index Update Logic
```rust
fn update_index(ctx) {
    let elapsed_slots = current_slot - ctx.premium_index.last_update_slot;
    let increment = elapsed_slots * ctx.premium_index.premium_rate;
    ctx.premium_index.current_index += increment;
    ctx.premium_index.last_update_slot = current_slot;
}
```

### Premium Settlement Logic
```rust
fn settle_premium(position, current_index) {
    let delta = current_index - position.entry_index;
    let amount = delta * position.size * MARKET_MULTIPLIER;
    return amount;
}
```

## Invariants
- **Monotonicity**: The `current_index` must never decrease.
- **Linearity**: Premium accrues linearly with time (slots) for a fixed size.

## Failure Modes & Errors
- **`IndexOverflow`**: Rare, but the index must use a large enough integer (u128).
- **`StaleIndex`**: If `update_index` isn't called, the index will be behind. All `mint/burn` calls must trigger an update.

## Security Notes
- **Rate Manipulation**: The `premium_rate` is an admin-set parameter in the `Market` PDA and cannot be changed by users.
- **Rounding**: Premium is rounded in favor of the protocol/receiver.

## Test Cases
- **Success**: Update index $\rightarrow$ Verify `current_index` increased.
- **Success**: Calculate premium for a position opened 100 slots ago $\rightarrow$ Verify amount matches formula.
- **Success**: Verify that `burn_options` triggers an index update before settlement.

## Observability & Events
- `PremiumIndexUpdated(market, new_index)`

## MVP Done Definition
- [ ] `GlobalPremiumIndex` PDA implemented.
- [ ] `update_index` logic operational.
- [ ] Premium calculation correctly integrated into the `burn_options` flow.
