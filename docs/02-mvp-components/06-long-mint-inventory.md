# Component: Long Mint (Inventory-Capped)

## Purpose
The Long Mint allows users to buy an option by utilizing existing short liquidity. Unlike the Short Mint, it does not add liquidity to the pool; instead, it creates a claim against the liquidity provided by others.

## User-Facing Behavior
The user sees a "Liquidity Available" indicator for a specific range. If liquidity exists, they can open a Long. If the range is "sold out" of shorts, the UI prevents the trade.

## Dependencies
- **Position Engine**: For creating the `Position` PDA.
- **`RangePremiumState`**: holds `total_short_liquidity` / `total_long_liquidity` per range; `available_short_liquidity()` is derived from them (never stored, never on `Market`).
- **Risk Engine**: To verify the user can afford the margin/premium ([component 09](09-risk-solvency.md): `InsolventMint`).

## State & PDAs

Leverages `Position` and `UserCollateral` PDAs. Per-range inventory lives on the `RangePremiumState` PDA (`["range", market, tick_lower_le, tick_upper_le]`), defined in [`08-burn-settle.md`](08-burn-settle.md) §A.

### Two liquidity totals — do not conflate them

| Quantity | Definition | Used for |
|---|---|---|
| `total_short_liquidity` | All open short liquidity in the range | **Premium pro-rata denominator** |
| `total_long_liquidity` | All open long liquidity in the range | Premium entitlement accrual |
| `available_short_liquidity` | `total_short_liquidity − total_long_liquidity` (derived, not stored) | **The long-mint gate only** |

A long mint consumes *available* inventory but leaves `total_short_liquidity` untouched — the shorts are still providing that liquidity and still earning on all of it.

> ⚠️ Using `available_short_liquidity` as the premium denominator would over-pay shorts as longs open (the denominator shrinks while the same shorts remain), breaking zero-sum. The denominator is always `total_short_liquidity`.

## Public Interface
Implemented as a specific path within the `mint_position` instruction.

## Algorithms & Pseudocode

### Long Minting Sequence
```rust
fn execute_long_mint(user, range, size) {
    // 1. Refresh the index, then poke the range BEFORE any weight change.
    //    Ordering is mandatory — see 08-burn-settle.md invariant 5.
    //    - premium_engine.update_index();
    //    - premium_engine.poke_range(r);

    // 2. Inventory gate (derived, not stored)
    //    - let available = r.total_short_liquidity - r.total_long_liquidity;
    //    - if (available < size) { return Error::NoShortInventory; }

    // 3. Solvency — must account for the premium this long will owe.
    //    risk::check_long_mint_allowed(user, existing_longs, index, market, size) → InsolventMint (09, ADR-0003)

    // 4. Create Position PDA
    //    - position_engine.create_position(user, LONG, range, size);

    // 5. Update range inventory (total_short_liquidity is NOT touched)
    //    - r.total_long_liquidity += size;

    // 6. Checkpoint premium state
    //    - position.entry_index = premium_index.current_index;
    //    - position.accrued_scaled = 0;
}
```

## Invariants
- **No Free Longs**: $\sum \text{Long Liquidity} \le \sum \text{Short Liquidity}$.
- **Solvency**: A Long position cannot be opened if it would immediately make the user insolvent (enforced by component 09's gate, which runs after 06's inventory gate).

## Failure Modes & Errors
- **`NoShortInventory`**: The requested range has no available short liquidity.
- **`InsolventMint`** (component 09): free USDC cannot cover existing long liability + `required_margin(L)`.

## Security Notes
- **Race Conditions**: Inventory must be updated atomically to prevent multiple users from claiming the same short liquidity in one block.
- **Inventory Reconciliation**: `available_short_liquidity()` is derived, so there is nothing stored to drift. `scripts/reconcile.mjs` cross-checks `total_short/long_liquidity` against the sum of open positions from outside the program.

## Test Cases
- **Success**: Mint Long when Short exists $\rightarrow$ Verify derived `available_short_liquidity` decreases **and `total_short_liquidity` is unchanged**.
- **Failure**: Mint Long when no Short exists $\rightarrow$ Expect `NoShortInventory`.
- **Failure**: Mint Long with insufficient collateral $\rightarrow$ Expect `InsolventMint` (`tests/risk-solvency.ts` R1).
- **Ordering**: Mint a Long into a range with elapsed unpoked time $\rightarrow$ Verify the new long earns no entitlement for the period before it existed (guards `poke_range` ordering).

## Observability & Events
- `LongMinted(user, range, size)`

## MVP Done Definition
- [x] Inventory check implemented on **`RangePremiumState`** (not `Market`) - `available = total_short - total_long`, derived never stored. *(component 06)*
- [x] `mint_position` rejects LONG with `NoShortInventory` when the range is missing or availability is short. *(component 06)*
- [x] Longs checkpoint `entry_index` at the current index, so they owe nothing for periods before they existed. *(component 06)*
