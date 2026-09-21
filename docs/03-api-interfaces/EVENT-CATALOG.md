# EVENT-CATALOG: On-chain events (Fair MVP)

The **21** Anchor events the PERMA program emits, as shipped through component 11 plus Protocol V1 **P1** (`AdminTransferred`, `RangeUnwound`, appended last — nothing above them was renamed or reordered). Names, fields and emitting instructions are the live ones (`programs/perma/src/lib.rs`, `// --- events ---` block); the IDL (`target/idl/perma.json`, mirrored at `apps/web/src/idl/`) carries a discriminator and a `types` entry for each. Decoded and asserted end-to-end by `tests/events.ts`; consumed by `apps/web/src/lib/events.ts`.

Anchor's TypeScript client reports names in **camelCase** (`shortMinted`); Rust and this table use the declared PascalCase.

## 1. Product path

| Event | Emitted by | Fields (in order) | Fair consumer use |
|---|---|---|---|
| `CollateralDeposited` | `deposit_collateral` | `market, owner: Pubkey; amount_a, amount_b, balance_a, balance_b: u64` | refetch collateral |
| `CollateralWithdrawn` | `withdraw_collateral` | same shape (`balance_*` = free balance after) | refetch collateral |
| `CollateralLocked` | `lock_collateral` | `market, owner; amount_a, amount_b, locked_a, locked_b: u64` | refetch collateral |
| `CollateralUnlocked` | `unlock_collateral` | same shape (`locked_*` after) | refetch collateral |
| `ShortMinted` | `mint_position` (SHORT) | `market, owner, perma_position, orca_position: Pubkey; tick_lower, tick_upper: i32; liquidity: u128; locked_a, locked_b: u64` (**observed** lock, not the caps); `open_positions: u16` | refetch positions, collateral, premium index, the named range |
| `LongMinted` | `mint_position` (LONG) via `mint_long_inner` | `market, owner, perma_position; tick_lower, tick_upper; size, entry_index, total_short_liquidity, total_long_liquidity, available_after: u128` (range snapshot **after**) | same as `ShortMinted` |
| `PremiumSettled` | `settle_premium` via `settle_long_cash` (leg 1) / `settle_short_cash` (leg 0) | `market, owner, perma_position; leg_type: u8; amount, still_owed, premium_pool, premium_owed_usdc: u64` | refetch positions, collateral, premium index, all known ranges (no ticks in payload). **`amount` is exactly the USDC that moved** — long: into the range escrow; short: out of it. |
| `LongBurned` | `burn_position` (LONG) via `burn_long_inner` | `market, owner, perma_position; size: u128; premium_paid_usdc: u64; total_long_liquidity, available_after: u128` | as `PremiumSettled` |
| `ShortBurned` | `burn_position` (SHORT) | `market, owner, perma_position; liquidity: u128; unlocked_a, unlocked_b, returned_a, returned_b, premium_claimed, premium_receivable: u64; status: u8; open_positions: u16` | as `PremiumSettled`. **`status`**: `1` CLOSED → the account is gone; `2` PENDING_PREMIUM → the account stays until `settle_premium` pays `premium_receivable`, then closes it (emitting `PremiumSettled` leg 0 first). |
| `RangeValidated` | `validate_short_range` (read-only dry run) | `market; tick_lower, tick_upper: i32; tick_array_lower, tick_array_upper: Pubkey; current_tick: i32` | none (no state change) |

## 2. Admin

| Event | Emitted by | Fields | Fair consumer use |
|---|---|---|---|
| `GlobalConfigInitialized` | `initialize_global_config` | `admin, allowlisted_whirlpool: Pubkey` | — |
| `MarketCreated` | `create_market` | `market, whirlpool: Pubkey; tick_spacing: u16; admin: Pubkey; premium_rate, premium_multiplier: u64` | refetch market |
| `MarketPauseSet` | `pause_market` — **only on a real transition** | `market, admin: Pubkey` | refetch market (badge → Paused) |
| `MarketPauseCleared` | `unpause_market` — only on a real transition | `market, admin` | refetch market |
| `MarketRiskParamsSet` | `set_market_risk_params` | `market, admin: Pubkey; long_margin_horizon_slots, long_margin_buffer_usdc: u64` | refetch market (solvency inputs changed) |
| `AdminTransferred` | `transfer_admin` (P1) — **only on a real change**; a self-transfer emits nothing | `global_config, old_admin, new_admin: Pubkey` | refetch config (admin custody moved) |
| `RangeUnwound` | `unwind_empty_range` (P1) | `market, admin: Pubkey; tick_lower, tick_upper: i32; amount_usdc: u64` | drop the range from any cached list — both its accounts are closed |

## 3. Adapter harness (not the product path)

| Event | Emitted by | Fields |
|---|---|---|
| `PositionOpened` | `adapter_open_position` | `market, perma_position, orca_position, position_mint: Pubkey; tick_lower, tick_upper: i32` |
| `PositionClosed` | `adapter_close_position` | `market, perma_position, orca_position` |
| `LiquidityAdded` | `adapter_add_liquidity` | `market, perma_position, orca_position; tick_lower, tick_upper; liquidity: u128; amount_a, amount_b: u64` |
| `LiquidityRemoved` | `adapter_remove_liquidity` | `market, perma_position, orca_position; liquidity: u128; amount_a, amount_b: u64; closed: bool` |

## 4. Decoding

- Events are Anchor `emit!`s: a base64 payload on a `Program data: ` log line (`Program log: ` is also accepted by the parser), `8-byte discriminator || borsh(struct)`.
- Logs are **not** returned by `confirmTransaction`; read them with `connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).meta.logMessages`, then `new EventParser(programId, program.coder).parseLogs(logs)` (`@coral-xyz/anchor` 0.32). Lines from other programs (Orca, Token, ComputeBudget) and undecodable payloads are skipped.
- **No event carries a slot or timestamp.** Take `slot` / `blockTime` from the transaction meta.
- A **failed** transaction's logs contain no PERMA events (the ix aborts before `emit!`); a consumer must never infer state from a failed tx.

## 5. Stability rules (binding)

1. Existing events are never renamed; their fields are never reordered or removed.
2. Additive only: prefer a **new** event over appending fields to an existing struct.
3. Pause events are `MarketPauseSet` / `MarketPauseCleared` — never `MarketPaused`, which is `PermaError::MarketPaused`.
4. Idempotent admin calls (`pause_market` on a paused market, `unpause_market` on an unpaused one) return `Ok(())` and **emit nothing**. Absence of the event is the signal.
5. `PremiumSettled` is emitted only when USDC actually moved — both emit sites sit behind `require!(> 0, NothingToSettle)`.

## 6. Deferred to P2

History series, `GET /markets`, `/positions/{owner}/history`, `/premium/series`, `/liquidations`, `/health`, Postgres/Prisma, websockets and charts are specified in [`docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`](../09-post-mvp/INDEXER-AND-PRODUCT-UI.md) and are **not** Fair scope. Fair's consumer is `apps/web/src/lib/events.ts` + `hooks/useSendPermaTx.ts`: decode the tx you just sent, refetch what it touched, keep polling as the source of truth.
