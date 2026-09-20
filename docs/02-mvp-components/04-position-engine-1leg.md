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
`PDA(["perma_position", market, owner, nonce.to_le_bytes()])` — `nonce` is caller-chosen; uniqueness is enforced by PDA `init`.
- `leg_type`: Long or Short.
- `tick_lower`: The lower boundary of the option.
- `tick_upper`: The upper boundary of the option.
- `liquidity`: The amount of liquidity backing the position (`u128`, Orca liquidity units).
- `status`: `Open`, `Closed`, or **`PendingPremium`** (a short still owed premium no long has funded). No `Liquidated` — Fair MVP has no liquidation.

Premium checkpoints — semantics in [`07-premium-engine.md`](07-premium-engine.md) §D:

| Field | Type | Leg | Meaning |
|---|---|---|---|
| `entry_index` | `u128` | Long | `GlobalPremiumIndex.current_index` at open or last settle |
| `accrued_scaled` | `u128` | Long | Unpaid sub-unit remainder, in `µUSDC × PREMIUM_SCALE` |
| `entry_acc_q64` | `u128` | Short | `RangePremiumState.acc_premium_per_short_q64` at open or last claim |
| `premium_receivable` | `u64` | Short | Premium earned but not yet funded (µUSDC) |

**`PendingPremium`** means a short has already removed its Orca liquidity and settled P&L, but still has an unfunded premium claim. The account stays alive only to hold that claim and is closed — with rent refunded — once [`settle_premium`](08-burn-settle.md) clears it.

## Public Interface

### `mint_position(leg: u8, tick_lower: i32, tick_upper: i32, liquidity: u128, token_max_a: u64, token_max_b: u64, nonce: u64)`
- **Action**:
    1. If SHORT: Lock collateral $\rightarrow$ Adapter `add_liquidity`.
    2. If LONG: Verify Short inventory (`NoShortInventory`) $\rightarrow$ `open_longs < 8` $\rightarrow$ solvency gate (`InsolventMint`, [component 09](09-risk-solvency.md)).
    3. Create `Position` PDA.
    4. Initialize premium state.

### `burn_position(token_min_a: u64, token_min_b: u64)`
- **Action**:
    1. Settle premium through the range bucket (`settle_premium`) — **before** any liquidity-weight change.
    2. If SHORT: Adapter `remove_liquidity` $\rightarrow$ Unlock collateral.
    3. Short: release what mint locked, credit what Orca returned — that difference **is** the realized LP result; there is no separate P&L step. Long: P&L = 0 ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)).
    4. Mark position `Closed`, or `PendingPremium` if a short's claim is still unfunded.
- Full pseudocode with token movements: [`08-burn-settle.md`](08-burn-settle.md) §E.

### `settle_premium()`
- **Action**: Move accrued premium between the position and its range bucket without closing the position.
- **Long path is permissionless** — anyone may crank it. Safe because of floor-with-carry rounding ([`07-premium-engine.md`](07-premium-engine.md) §C).

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
        risk::check_long_mint_allowed(user, existing_longs, index, market, size)?;   // InsolventMint (09)
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
- `ShortMinted { market, owner, perma_position, orca_position, tick_lower, tick_upper, liquidity, locked_a, locked_b, open_positions }`
- `LongMinted { market, owner, perma_position, tick_lower, tick_upper, size, entry_index, total_short_liquidity, total_long_liquidity, available_after }`
- `ShortBurned { market, owner, perma_position, liquidity, unlocked_a, unlocked_b, returned_a, returned_b, premium_claimed, premium_receivable, status, open_positions }`
- `LongBurned { market, owner, perma_position, size, premium_paid_usdc, total_long_liquidity, available_after }`

## MVP Done Definition
- [x] `Position` PDA implemented as `PermaPosition`. *(04/05; seeds deviate — see report)*
- [x] `mint_position` operational for **Short** *(04/05)* and **Long** *(06)*.
- [x] `burn_position` triggers the 3-step Orca close and releases collateral *(04/05)*; premium settles in cash on both legs *(08)*.
- [x] Long-inventory check strictly enforced. *(06 — `NoShortInventory`)*
