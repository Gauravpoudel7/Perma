# Component: Long Mint (Inventory-Capped)

## Purpose
The Long Mint allows users to buy an option by utilizing existing short liquidity. Unlike the Short Mint, it does not add liquidity to the pool; instead, it creates a claim against the liquidity provided by others.

## User-Facing Behavior
The user sees a "Liquidity Available" indicator for a specific range. If liquidity exists, they can open a Long. If the range is "sold out" of shorts, the UI prevents the trade.

## Dependencies
- **Position Engine**: For creating the `Position` PDA.
- **Market**: To track the total `available_short_liquidity` for a range.
- **Risk Engine**: To verify the user can afford the margin/premium.

## State & PDAs
Leverages `Position` and `UserCollateral` PDAs. The `Market` PDA tracks global liquidity inventory.

## Public Interface
Implemented as a specific path within the `mint_options` instruction.

## Algorithms & Pseudocode

### Long Minting Sequence
```rust
fn execute_long_mint(user, range, size) {
    // 1. Check inventory in Market PDA
    //    - if (market.available_short_liquidity(range) < size) {
    //        return Error::NoShortInventory;
    //    }
    
    // 2. Verify user solvency for the long position
    //    - risk_engine.verify_solvency(user, size);
    
    // 3. Create Position PDA
    //    - position_engine.create_position(user, LONG, range, size);
    
    // 4. Update Market inventory
    //    - market.available_short_liquidity(range) -= size;
    
    // 5. Set entry premium index
    //    - position.entry_index = premium_engine.get_current_index();
}
```

## Invariants
- **No Free Longs**: $\sum \text{Long Liquidity} \le \sum \text{Short Liquidity}$.
- **Solvency**: A Long position cannot be opened if it would immediately make the user insolvent.

## Failure Modes & Errors
- **`NoShortInventory`**: The requested range has no available short liquidity.
- **`InsolventMint`**: User's collateral is insufficient to back the long position's margin requirements.

## Security Notes
- **Race Conditions**: Inventory must be updated atomically to prevent multiple users from claiming the same short liquidity in one block.
- **Inventory Reconciliation**: A background process or "poke" should occasionally reconcile `available_short_liquidity` with the actual sum of `Position` PDAs.

## Test Cases
- **Success**: Mint Long when Short exists $\rightarrow$ Verify `Market.available_short_liquidity` decreases.
- **Failure**: Mint Long when no Short exists $\rightarrow$ Expect `NoShortInventory`.
- **Failure**: Mint Long with insufficient collateral $\rightarrow$ Expect `InsolventMint`.

## Observability & Events
- `LongMinted(user, range, size)`

## MVP Done Definition
- [ ] Inventory check logic implemented in `Market` PDA.
- [ ] `mint_options` correctly rejects Longs when inventory is zero.
- [ ] Long positions correctly initialize with the current premium index.
