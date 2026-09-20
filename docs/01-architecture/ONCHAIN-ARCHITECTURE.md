# ONCHAIN ARCHITECTURE: PERMA Program

## Program Structure
The PERMA program is built using the **Anchor Framework**. It is structured as a set of modular logic units that interact via a central `Market` coordinator.

## Account Layout

Live layouts are in `programs/perma/src/state.rs`; this is the shape, not the byte map.

### 1. `GlobalConfig` — `["global_config"]`
- `admin: Pubkey`, `allowlisted_whirlpool: Pubkey` (**one** pool, immutable), `bump`. No global pause flag.

### 2. `Market` — `["market", whirlpool]`
- Whirlpool + its config, mints and Orca vaults; PERMA `vault_a` / `vault_b` (ATAs of `market_authority`); `tick_spacing`; `has_active_rewards`; `is_paused` (never set in Fair MVP); `premium_rate`, `premium_multiplier`. Component 09 appends `long_margin_horizon_slots`, `long_margin_buffer_usdc`. **No inventory here** — see 5.

### 3. `UserCollateral` — `["collateral", market, owner]`
- `balance_a` / `locked_a` (WSOL), `balance_b` / `locked_b` (devUSDC), `premium_owed_usdc` (legacy, only paid down), `open_positions` (shorts). Component 09 appends `open_longs`.

### 4. `PermaPosition` — `["perma_position", market, owner, nonce_le]`
- `orca_position`, `position_mint` (SHORT only), `tick_lower` / `tick_upper`, `liquidity: u128`, `in_orca_a/b`, `locked_a/b`, `leg_type`, `status: Open | Closed | PendingPremium` (no `Liquidated`), `entry_index` + `accrued_scaled` (LONG), `entry_acc_q64` + `premium_receivable` (SHORT), `nonce`, `bump`.

### 5. `GlobalPremiumIndex` — `["premium_index", market]`
- `current_index: u128`, `last_update_slot`. A pure function of elapsed slots.

### 6. `RangePremiumState` — `["range", market, lower_le, upper_le]`
- `total_short_liquidity` / `total_long_liquidity` (`u128`; `available_short_liquidity()` derived), `acc_premium_per_short_q64`, `last_index`, `premium_pool`, `receivable`, `dust` (reserved, 0). Created by the first short in a range.

### 7. `range_vault` — `["range_vault", market, lower_le, upper_le]`
- An SPL token account (devUSDC, authority `market_authority`), the per-range premium escrow. **Not** `Market.vault_b`.

### 8. `market_authority` — `["market_authority", market]`
- Signer PDA for every vault transfer and Orca CPI; owns the position NFTs.

## CPI Flow: The Orca Interaction
The most critical path in the program is the `Position Engine` $\rightarrow$ `CLMM Adapter` $\rightarrow$ `Orca Whirlpool` flow.

1. **Validation**: PERMA verifies the user has enough collateral.
2. **CPI**: PERMA calls `whirlpool::open_position` then `whirlpool::increase_liquidity_v2(...)` for the tick range, signed by `market_authority`; **Orca pulls** the tokens from PERMA's `vault_a` / `vault_b`.
3. **Measure**: PERMA snapshots the vault balances before and after and **locks the observed spend** — not a quote, not `token_max_*`.
4. **Confirmation**: `SlippageExceeded` if the observed spend breached the caps; `in_orca_*` is recorded so conservation stays checkable.

## Memory & Compute Budget (CU)
To ensure transactions fit within Solana's limits:
- **Tick Arrays**: The program optimizes the number of tick arrays passed to the adapter.
- **Batching**: Multi-leg positions (deferred to V1) will require a multi-instruction transaction (IX) flow.
- **PDAs**: Minimal seed lengths are used to reduce hashing costs.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
