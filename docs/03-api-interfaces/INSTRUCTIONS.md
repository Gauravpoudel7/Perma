# INSTRUCTIONS: Program Interface

The **19** public instructions of the PERMA program, as shipped through component 10 plus Protocol V1 **P1** (`transfer_admin`, `unwind_empty_range`). Names, parameters and account lists are the live ones (`programs/perma/src/lib.rs`); the working client patterns are in `tests/*.ts`. Sizes were measured on a local validator with `scripts/measure-position.mjs` (2026-09-20).

`Market.is_paused` (written by `pause_market` / `unpause_market`, component 10) gates only the **risk-increasing** instructions: `mint_position`, `deposit_collateral`, `lock_collateral`, `adapter_open_position`, `adapter_add_liquidity` reject `MarketPaused`. Exit paths — `burn_position`, `settle_premium`, `withdraw_collateral`, `unlock_collateral`, `adapter_close_position`, `adapter_remove_liquidity` — and the read-only `validate_short_range` run while paused, subject to their own gates. Full matrix: [`10-pause-admin.md`](../02-mvp-components/10-pause-admin.md). Every instruction emits an Anchor event on success — see [`EVENT-CATALOG.md`](EVENT-CATALOG.md).

## 1. Global Administration

### `initialize_global_config(allowlisted_whirlpool: Pubkey)`
- **Purpose**: Set the protocol admin and the single-pool allowlist.
- **Accounts**: `admin` (Signer, Write), `global_config` (Write, init, PDA `["global_config"]`), `system_program`.
- **Params**: **one** pool, not a `Vec`. Fair MVP allowlists exactly one Whirlpool, so the type enforces the PRD constraint. Rejects `Pubkey::default()` with `InvalidAllowlistEntry`.
- **Note**: there is **no setter**. The allowlist is immutable after init, so an admin-key compromise cannot repoint the protocol at another pool. See [`IMPL-02-FACTORY-REPORT.md`](../audits/IMPL-02-FACTORY-REPORT.md).

### `create_market()`
- **Purpose**: Register the allowlisted Orca market.
- **Caller**: **admin only** (`global_config.admin`).
- **Accounts**: `admin` (Signer, Write), `global_config`, `market` (Write, init, PDA `["market", whirlpool]`), `market_authority` (PDA `["market_authority", market]`), `whirlpool`, `vault_a` / `vault_b` (the PERMA ATAs owned by `market_authority`), `whirlpool_program`, `system_program`.
- **Params**: none — the pool arrives as an account and the `Market` PDA derives from it. Premium parameters are set from `premium_defaults` and risk parameters from `risk_defaults` (`long_margin_horizon_slots = 1_000`, `long_margin_buffer_usdc = 1_000_000`). Premium parameters have **no update path**; the two risk parameters are updated by `set_market_risk_params` (below).
- **Guards**: `Unauthorized` → `PoolNotAllowlisted` → Whirlpool program ID → active rewards → live geometry → PERMA vault mint/owner.

### `pause_market()` / `unpause_market()`
- **Purpose**: trip / clear the circuit breaker (component 10). See the matrix note at the top of this file for what a pause blocks.
- **Caller**: **admin only** (`global_config.admin`), else `Unauthorized`.
- **Accounts**: `admin` (Signer), `global_config` (PDA `["global_config"]`), `market` (Write, PDA `["market", market.whirlpool]`). No payer: the only write is the existing `is_paused` byte.
- **Idempotent**: pausing an already-paused market (or unpausing an unpaused one) returns `Ok(())` and emits nothing. A real transition emits `MarketPauseSet { market, admin }` / `MarketPauseCleared { market, admin }`.
- **Size**: 244 bytes (measured, `tests/pause-admin.ts`).

### `set_market_risk_params(long_margin_horizon_slots: u64, long_margin_buffer_usdc: u64)`
- **Purpose**: set the ADR-0003 long-margin parameters (component 10). Writes exactly those two `Market` fields in place — never `premium_rate` / `premium_multiplier`.
- **Caller**: admin only, else `Unauthorized`. **Accounts**: as `pause_market`.
- **Guard**: `risk::validate_risk_params` rejects `InvalidRiskParams` when `horizon == 0`, `buffer == 0`, or the margin at `risk::MARGIN_LIQUIDITY_BOUND` (2^52) — or its `MAX_OPEN_LONGS`-fold sum — would overflow `u64` under the current rate/multiplier (ADR-0003's "overflow at withdraw locks funds" requirement). Nothing is written on rejection.
- **Emits**: `MarketRiskParamsSet { market, admin, long_margin_horizon_slots, long_margin_buffer_usdc }`. **Size**: 260 bytes.

### `transfer_admin(new_admin: Pubkey)`
- **Purpose**: hand `GlobalConfig.admin` to another key — in practice a Squads vault, so the protocol's admin authority becomes a multisig (P1). PERMA contains **no multisig CPI**: the vault is simply the pubkey that must sign.
- **Caller**: **admin only** (`global_config.admin`), else `Unauthorized`.
- **Accounts**: `admin` (Signer), `global_config` (Write, PDA `["global_config"]`). No payer, no `system_program`: the only write is the existing 32-byte `admin` field, in place.
- **Params**: `new_admin`. `Pubkey::default()` is rejected with `InvalidAdmin` — a config nobody can sign for is a protocol with no operator.
- **Idempotent**: transferring to the current admin returns `Ok(())` and emits nothing, so a retried ops script leaves no phantom handoff in the log.
- **Emits**: `AdminTransferred { global_config, old_admin, new_admin }`.
- **Ops**: `yarn transfer-admin <pubkey>` from `apps/web`; procedure in [`RUNBOOK-DEVNET.md`](../07-ops-presentation/RUNBOOK-DEVNET.md) §Admin custody.

### `unwind_empty_range()`
- **Purpose**: sweep the premium residue out of a range nobody is in any more, and close both of its accounts (P1; specified by [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md) §F and [ADR-0002](../adr/ADR-0002-premium-accounting.md)). The floored Q64.64 split leaves a µUSDC or two attributable to nobody; this is the only path by which the protocol ever receives premium.
- **Caller**: **admin only**, else `Unauthorized`.
- **Accounts**: `admin` (Signer, Write — receives the swept USDC's destination check and the rent from both closures), `global_config`, `market`, `market_authority`, `range_state` (Write, `close = admin`, PDA seeded from its own recorded ticks), `range_vault` (Write), `destination` (Write — a USDC token account **owned by the signing admin**, asserted by `check_user_ata`), `token_program`.
- **Params**: none. The ticks come from `range_state`, so a caller cannot point the instruction at one range's books while passing another's vault.
- **Guards**, all fail-closed and all before any transfer: `range_state.market` matches; `total_short_liquidity == 0`, `total_long_liquidity == 0` and `receivable == 0` (else `RangeNotEmpty` — the last one matters most, because a `PendingPremium` short has left `total_short_liquidity` but is still owed cash); the `range_vault` PDA re-derives; both token accounts carry the right mint and owner; and `range_vault.amount == premium_pool + dust` (else `RangeStateMismatch`), asserting the shipped identity on the way out rather than trusting the books.
- **Moves no user funds**: `Market.vault_a` / `vault_b`, every `UserCollateral` balance, and every `premium_receivable` are untouched.
- **Re-creation is safe**: `mint_position` re-creates `range_state` with `init_if_needed`, and `poke_range` only accumulates while both liquidity sides are non-zero, so a re-created range behaves exactly like a brand-new one.
- **Emits**: `RangeUnwound { market, admin, tick_lower, tick_upper, amount_usdc }`.

## 2. Collateral Management

All four take `amount_a` (WSOL) and `amount_b` (devUSDC), in native units.

### `deposit_collateral(amount_a: u64, amount_b: u64)`
- **Accounts**: `owner` (Signer, Write), `market`, `user_collateral` (Write, init_if_needed, PDA `["collateral", market, owner]`), `user_token_a` / `user_token_b` (owner's ATAs), `vault_a` / `vault_b` (Write), `token_program`, `system_program`.
- Free balance only. `ZeroAmount` if both are zero.

### `withdraw_collateral(amount_a: u64, amount_b: u64)`
- **Accounts**: `owner` (Signer, Write), `market`, `market_authority`, `user_collateral` (Write), `user_token_a` / `user_token_b` (Write), `vault_a` / `vault_b` (Write), `token_program`, `premium_index` (read-only; may not exist yet on a fresh ledger, which is fine while the user has no longs). **Remaining accounts**: every open LONG `PermaPosition` for `(market, owner)` — exactly `user_collateral.open_longs` of them, else `MissingOpenLong`. Measured: 524 B with one long, 755 B with eight.
- **Guard**: `risk::check_withdraw_allowed` — the single withdraw seam. Free balance covers the request (`InsufficientFunds`), and free USDC after ≥ `premium_owed_usdc + Σ (accrued premium + required_margin)` over the open longs (`InsolventWithdrawal`), with the premium index **projected** to the current slot so an uncranked long cannot be under-counted ([`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md), [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). With no longs this reduces to the component-03 check.
- Locked collateral is unreachable by construction: only free balance is debited.

### `lock_collateral(amount_a: u64, amount_b: u64)` / `unlock_collateral(amount_a: u64, amount_b: u64)`
- **Accounts**: `owner` (Signer), `market`, `user_collateral` (Write).
- Move free ↔ locked with no token transfer. `unlock` is refused with `PositionsOutstanding` while `open_positions > 0`. Kept as an explicit primitive; `mint_position` / `burn_position` lock and unlock internally.

## 3. Position Lifecycle

### `validate_short_range(tick_lower: i32, tick_upper: i32)`
- **Purpose**: Dry-run every adapter check for a range without minting — allowlist, program ID, alignment, bounds, TickArray existence.
- **Accounts**: `market`, `market_authority`, `whirlpool`, `tick_array_lower`, `tick_array_upper`, `whirlpool_program`. No remaining accounts (`UnexpectedRemainingAccounts`).
- Emits `RangeValidated`.

### `mint_position(leg: u8, tick_lower: i32, tick_upper: i32, liquidity: u128, token_max_a: u64, token_max_b: u64, nonce: u64)`
- **Purpose**: Open a position. **SHORT (0) and LONG (1) are both live.** `InvalidLegType` for anything else.
- **Oracle gate** (both legs, P3 — [ADR-0004](../adr/ADR-0004-oracle-and-price-aware-risk.md)): after the pause / leg / zero checks and before anything else, `price_update` must be a `Full`-verified Pyth SOL/USD `PriceUpdateV2` owned by the receiver (`OracleUnavailable`), at most 60 s old (`OracleStale`), with confidence ≤ 1 % (`OracleConfidenceTooWide`), and within 2 % of the Whirlpool spot (`OracleDeviationTooHigh`). Fail closed: the instruction is rejected; the market is not paused. No other instruction reads the oracle.
- **Shared prefix** (both legs): `update_index` → `poke_range` **before** any weight changes; lazily creates `premium_index` and `range_state` on first use.
- **SHORT**: locks collateral, creates the range's `range_vault` escrow on the first short in that range, CPIs Orca `open_position` **and** `increase_liquidity_v2` in one transaction (no orphaned Orca position possible), **locks the observed spend** (not `token_max_*`), then `total_short_liquidity += liquidity`. Measured: **1189 bytes / 29 accounts / ~158k CU — 43 bytes of headroom** (P3; was 1156 B before `price_update`). No remaining accounts.
- **LONG**: no Orca CPI, no vault touch, no lock. Gates in order: inventory `available_short_liquidity() >= liquidity` (`NoShortInventory`) → `open_longs < 8` (`TooManyOpenLongs`) → solvency: free USDC ≥ Σ over existing longs (accrued + margin) + `required_margin(liquidity)` (`InsolventMint`). **Every Orca-side account except `whirlpool` is passed as `null`** (`whirlpool` is read for the oracle spot check only) and there is no position-mint signer; the **remaining accounts** are the owner's existing open longs (`MissingOpenLong` if the set is wrong). `token_max_*` are ignored; pass `0`. Then `total_long_liquidity += liquidity`. Measured: **677 B / 15 accounts** with no longs, **908 B** with seven (P3; was 612 / 843 B).
- **Accounts**: `owner` (Signer, Write), `market`, `market_authority`, `user_collateral` (Write), `perma_position` (Write, init, PDA `["perma_position", market, owner, nonce_le]`), `premium_index` (Write, init_if_needed), `range_state` (Write, init_if_needed, PDA `["range", market, lower_le, upper_le]`), `range_vault` (Write, PDA `["range_vault", market, lower_le, upper_le]` — **not** `Market.vault_b`), `token_program`, `system_program`, `rent`, `price_update` (read, **both legs**, last in the account list); then, **`Option` — required for SHORT, `null` for LONG**: `whirlpool` (**required for both legs** since P3), `orca_position`, `position_mint` (Signer), `position_token_account`, `token_mint_a` / `token_mint_b`, `vault_a` / `vault_b`, `orca_vault_a` / `orca_vault_b`, `tick_array_lower` / `tick_array_upper`, `associated_token_program`, `memo_program`, `whirlpool_program`.
- Emits `ShortMinted` or `LongMinted`.

### `burn_position(token_min_a: u64, token_min_b: u64)`
- **Purpose**: Close a position. Branches on the stored leg.
- **Shared prefix**: `update_index` → `poke_range`.
- **SHORT**: claim premium **first** (while still in `total_short_liquidity`; paid from `range_vault`, shortfall carried on `premium_receivable`) → Orca 3-step close `decrease_liquidity_v2` → `collect_fees_v2` → `close_position` → `total_short_liquidity −= liquidity` (must stay ≥ `total_long_liquidity`, else `InventoryInvariantViolated`) → `close_short` releases what mint locked and credits what Orca returned (**the difference is the realized LP result; there is no separate P&L step**) → status `Closed`, or **`PendingPremium`** when premium is still owed (the account survives to carry the claim). Measured: **960 bytes / 25 accounts / ~119k CU.**
- **LONG**: settle accrued premium **in cash** (`vault_b → range_vault`; `InsufficientCollateralForLoss` if free USDC cannot cover it, and the position stays `Open`) → `close_long` (**P&L = 0** — [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)) → `total_long_liquidity −= size` → rent back.
- **Accounts**: `owner` (Signer, Write), `market`, `market_authority`, `user_collateral` (Write), `perma_position` (Write), `premium_index` (Write), `range_state` (Write), `range_vault` (Write, **both legs**), then the Orca set as `Option`s — SHORT passes all of them; LONG passes `null` for every Orca account **except `vault_b` and `token_program`**, which the cash settle needs.
- Emits `ShortBurned` or `LongBurned`.

### `settle_premium()`
- **Purpose**: Move accrued premium between a position and its range escrow **without closing the position**. Every path transfers USDC and updates the books in the same function — a liability is never cleared without a transfer.
- **Accounts**: `cranker` (Signer), `owner` (Write, unchecked — receives rent when a `PendingPremium` short finally closes), `market`, `market_authority`, `user_collateral` (Write), `perma_position` (Write, seeds from `owner`), `premium_index` (Write), `range_state` (Write, seeds from the **position's** ticks), `range_vault` (Write), `vault_b` (Write), `token_program`. Measured: **476 bytes / 11 accounts / ~30k CU.**
- **Params**: none — the position determines the leg and the amount.
- **LONG: permissionless.** Any `cranker` may settle any open long; the owner pays, the cranker earns nothing. Safe because floor-with-carry rounding makes settle frequency irrelevant to the total owed ([`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) §C). Pays down the legacy `premium_owed_usdc` by `min(owed, payable)` — never more than was transferred.
- **SHORT: owner only** (`cranker == owner`, else `Unauthorized`). Pays `min(claimable + premium_receivable, premium_pool)`; a `PendingPremium` short whose carry reaches zero closes and refunds rent.
- **Errors**: `NothingToSettle`, `RangeStateMismatch`, `InsufficientCollateralForLoss`, `Unauthorized`, `PositionAlreadyClosed`, `InvalidLegType`, `MarketPaused`.

## 4. Low-level adapter harness

Exercise the Orca CPI surface directly, without the position engine. **Refused with `HarnessPathUnavailable` on any range that has open longs**, because they do not maintain range weights. Used by `tests/adapter.ts` and `tests/adapter-liquidity.ts`.

| Instruction | Params |
|---|---|
| `adapter_open_position(tick_lower, tick_upper, nonce)` | opens an Orca position owned by `market_authority`, no liquidity |
| `adapter_add_liquidity(liquidity, token_max_a, token_max_b)` | `increase_liquidity_v2` from the PERMA vaults |
| `adapter_remove_liquidity(liquidity, token_min_a, token_min_b, close_after: bool)` | `decrease_liquidity_v2` → `collect_fees_v2` (→ `close_position`) |
| `adapter_close_position()` | burns the position NFT, reclaims rent |

## 5. Not instructions

- **There is no standalone index poke.** `GlobalPremiumIndex` is a pure function of elapsed slots; `mint_position`, `burn_position` and `settle_premium` each refresh it before use, and a late refresh catches up exactly. An earlier draft listed a `poke_observations` instruction that also "updated pool observations" — **Orca Whirlpool has no observations**, and no such instruction exists.
- **There is no `liquidate_account`** and no force-exercise.
- **There is no admin path that moves user funds.** `unwind_empty_range` (P1, above) sweeps only the unattributable premium residue of a range that every position has already left; `Market.vault_a` / `vault_b` and every `UserCollateral` balance remain unreachable to the admin.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
