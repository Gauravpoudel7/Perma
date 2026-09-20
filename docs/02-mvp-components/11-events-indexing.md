# Component: Events Indexing

## Purpose
The Events Indexing component ensures that the off-chain frontend has a real-time, accurate view of the protocol's state. Since reading thousands of PDAs directly via RPC is inefficient, the indexer listens for on-chain events and caches the state in a database.

## User-Facing Behavior
Users experience "instant" updates to their portfolio, premium accrual, and market liquidity without having to manually refresh the page.

## Dependencies
- **Solana RPC**: For fetching transaction logs and account data.
- **Frontend API**: The interface that serves the cached data to the React app.

## State & PDAs
This component is entirely off-chain. It mirrors the state of the `Position`, `Market`, and `UserCollateral` PDAs.

## Public Interface (API)

### `GET /positions/{user}`
- **Returns**: List of all active positions for the user. *(No on-chain P&L exists to surface — Fair MVP values nothing against a price; see ADR-0003.)*

### `GET /market/{pool}`
- **Returns**: Current short liquidity inventory and premium rate.

### `GET /user/{user}/collateral`
- **Returns**: Current balances (`balance_*`, `locked_*`, `premium_owed_usdc`, `open_positions`). *(A solvency figure arrives with component 09's margin fields.)*

## Algorithms & Pseudocode

### Indexing Loop
```javascript
async function indexLoop() {
    const logs = await rpc.getSignaturesForAddress(PROGRAM_ID);
    for (const sig of logs) {
        const tx = await rpc.getTransaction(sig);
        const events = parseEvents(tx.logs);
        
        for (const event of events) {
            // Live event names (programs/perma/src/lib.rs): ShortMinted, LongMinted, ShortBurned, LongBurned,
            // PremiumSettled, PositionOpened/PositionClosed + LiquidityAdded/LiquidityRemoved (adapter harness),
            // CollateralDeposited/Withdrawn/Locked/Unlocked, MarketCreated, GlobalConfigInitialized, RangeValidated.
            if (event.type === 'ShortMinted' || event.type === 'LongMinted') {
                await db.positions.insert(event.data);
            } else if (event.type === 'ShortBurned') {
                await db.positions.update(event.data.permaPosition, { status: event.data.status }); // Closed or PendingPremium
            } else if (event.type === 'LongBurned') {
                await db.positions.update(event.data.permaPosition, { status: 'Closed' });
            }
            // ... other events
        }
    }
}
```

## Invariants
- **Eventual Consistency**: The indexer must eventually reflect the exact state of the on-chain PDAs.
- **No Missed Events**: The indexer must track the last processed slot to ensure no gaps in the event stream.

## Failure Modes & Errors
- **RPC Rate Limit**: The indexer may be throttled by the RPC provider. Mitigation: Use a dedicated RPC node.
- **Re-orgs**: A block re-org could invalidate a processed event. Mitigation: Wait for "finalized" commitment before indexing.

## Security Notes
- **Read-Only**: The indexer has no write access to the blockchain; it is a pure observer.
- **Data Integrity**: The frontend should occasionally "cross-check" critical values (like collateral balance) directly against the RPC before a trade.

## Test Cases
- **Success**: Mint a position on-chain $\rightarrow$ Verify it appears in the API within seconds.
- **Success**: Burn a position $\rightarrow$ Verify it is marked as `Closed` in the database.
- **Failure**: Simulate an RPC timeout $\rightarrow$ Verify the indexer retries and eventually catches up.

## Observability & Events
- `IndexerSyncComplete(last_slot)`
- `IndexerError(slot, error)`

## MVP Done Definition
- [ ] Basic listener for `ShortMinted` / `LongMinted` / `ShortBurned` / `LongBurned` / `PremiumSettled`.
- [ ] Simple API providing current position lists for users.
- [ ] Integration with the frontend "Portfolio" view.
