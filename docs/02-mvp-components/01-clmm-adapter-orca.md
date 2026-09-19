# Component: CLMM Adapter (Orca Whirlpool)

## Purpose
The CLMM Adapter is the translation layer between PERMA's internal position logic and the Orca Whirlpool program. It abstracts the complexity of Whirlpool's account structure and CPI calls, providing a clean interface for adding/removing liquidity and reading market state.

## User-Facing Behavior
The adapter operates entirely in the background. When a user opens a SHORT position, the adapter ensures that the correct amount of SOL and USDC is transferred to the Whirlpool and the liquidity is deposited into the specific tick range selected by the user.

## Dependencies
- **Orca Whirlpool Program**: The target CPI destination.
- **SPL Token Program**: For handling asset transfers.
- **Position Engine**: The primary caller of the adapter.

## State & PDAs
The adapter itself is largely stateless, acting as a functional wrapper. However, it interacts with:
- **Whirlpool Account**: The pool state (SOL/USDC).
- **Tick Array Accounts**: Used to track liquidity across the range.
- **Whirlpool Position Account**: The account that holds the actual LP token/state for a specific range.

## Public Interface

### `get_pool_state()`
- **Input**: `pool_address`
- **Output**: `current_tick`, `sqrt_price`, `liquidity`

### `add_liquidity(pool, tick_lower, tick_upper, amount_a, amount_b)`
- **Action**: Executes CPI to Orca `increase_position`.
- **Returns**: `liquidity_added`

### `remove_liquidity(pool, tick_lower, tick_upper, liquidity_amount)`
- **Action**: Executes CPI to Orca `decrease_position`.
- **Returns**: `amount_a_recovered`, `amount_b_recovered`

### `get_observations()`
- **Action**: Fetches recent price observations from the pool for TWAP calculations.

## Algorithms & Pseudocode

### Liquidity Addition Flow
```rust
fn add_liquidity_flow(ctx, range, amounts) {
    // 1. Validate that range is within pool limits
    // 2. Calculate required tick_array_indexes
    // 3. Transfer assets from CollateralManager to Whirlpool
    // 4. CPI call: whirlpool::increase_position(
    //      tick_lower, 
    //      tick_upper, 
    //      amounts, 
    //      ...)
    // 5. Verify liquidity increase matches expectations
}
```

## Invariants
- **Asset Conservation**: Assets removed from PERMA collateral must equal assets added to Whirlpool (minus small rounding).
- **Tick Validity**: `tick_lower` must always be less than `tick_upper`.

## Failure Modes & Errors
- **`SlippageExceeded`**: The price moved too much between the request and execution.
- **`InsufficientPoolLiquidity`**: Unable to initialize the range.
- **`CPIFailure`**: Orca program returned an error.

## Security Notes
- **Strict Account Validation**: All Orca-provided accounts must be verified against the known Pool address to prevent "fake pool" attacks.
- **Slippage Guards**: Every liquidity operation must include a minimum output/maximum input check to prevent sandwich attacks.

## Test Cases
- **Success**: Add liquidity to a range and verify the Whirlpool position account reflects the increase.
- **Success**: Remove liquidity and verify assets return to PERMA collateral.
- **Failure**: Attempt to add liquidity to an invalid tick range $\rightarrow$ Expect `InvalidTick`.
- **Failure**: Attempt to add liquidity with insufficient collateral $\rightarrow$ Expect `InsufficientFunds`.

## Observability & Events
- `LiquidityAdded(pool, tick_lower, tick_upper, liquidity)`
- `LiquidityRemoved(pool, tick_lower, tick_upper, liquidity)`

## MVP Done Definition
- [ ] Successfully calls Orca `increase_position` and `decrease_position` via CPI.
- [ ] Correctly handles SOL/USDC asset transfers.
- [ ] Reads `current_tick` and `sqrt_price` reliably.
