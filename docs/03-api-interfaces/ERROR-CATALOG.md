# ERROR CATALOG: PERMA

Every error the PERMA program can return, as defined in the `PermaError` enum (`programs/perma/src/errors.rs`).

> **Which number do integrators see?** Anchor assigns on-chain codes as **`6000 + declaration index`** — `InsufficientFunds` is `6000` (`0x1770`), `InsolventWithdrawal` is `6001`, and so on. The short **catalog label** in the first column (`0x01`, `0x41`, …) is a documentation grouping key that also appears in the Rust doc comments; it is **not** the on-chain code. Match on the **name** (Anchor's error message carries it) or on the on-chain column. New variants are always **appended** so existing codes never shift.

## 1. Collateral Errors

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x01` | 6000 | `InsufficientFunds` | Not enough free balance for the requested action (deposit/withdraw/lock, or a short mint whose free balance does not cover `token_max_*`). |
| `0x02` | 6001 | `InsolventWithdrawal` | Withdrawal would leave free USDC below `premium_owed_usdc + Σ (accrued premium + margin)` over the user's open longs, with the premium index projected to *now* ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)). |
| `0x53` | 6002 | `InsufficientCollateralForLoss` | A long's free USDC cannot cover accrued premium at settle or burn. Premium is a **senior claim**; `debit_usdc` refuses to raid `locked_b`. Fair MVP has no liquidation, so the position stays `Open` with the debt standing. |
| `0x04` | 6003 | `PositionsOutstanding` | `unlock_collateral` while `open_positions > 0`. |
| `0x05` | 6012 | `ZeroAmount` | An amount argument was zero where a positive value is required. |
| `0x03` | 6028 | `InvalidAsset` | A token account is not the expected mint/owner (vault, user ATA, escrow), or a required optional account is missing. |

## 2. Position Errors

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x13` | 6004 | `InvalidLegType` | `leg` is neither `SHORT (0)` nor `LONG (1)`. |
| `0x12` | 6005 | `PositionAlreadyClosed` | The position is not `Open`. |
| `0x10` | 6006 | `NoShortInventory` | Long requested more than `available_short_liquidity()` for the range, or the range has never had a short. |
| `0x14` | 6007 | `InventoryInvariantViolated` | A short burn would leave `total_short_liquidity < total_long_liquidity`. |
| `0x15` | 6008 | `HarnessPathUnavailable` | An `adapter_*` harness instruction was used on a range that has open longs. |
| `0x11` | 6027 | `InvalidRange` | `tick_lower >= tick_upper`, or the supplied `RangePremiumState` was created for different ticks. (Alignment and bounds have their own errors below.) |

## 3. Premium & Settlement Errors

Raised by [`07-premium-engine.md`](../02-mvp-components/07-premium-engine.md) and [`08-burn-settle.md`](../02-mvp-components/08-burn-settle.md).

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x50` | 6009 | `NothingToSettle` | `settle_premium` with nothing payable (long) or nothing claimable (short). A long below the µUSDC floor is not an error state — it just has nothing to settle yet. |
| `0x51` | 6010 | `RangeStateMismatch` | The supplied `range_vault` (or `RangePremiumState`) does not derive from the position's ticks. |
| `0x52` | 6011 | `PremiumPoolUnderfunded` | **Defensive.** A claim exceeded `premium_pool`. Should be unreachable — an accounting bug, not a user condition. |

> `PremiumIndexStale` is intentionally **not** an error. The index is a pure function of elapsed slots, so a lagging index is caught up exactly by the next `update_index`; every instruction that reads it refreshes it first, and component 09 *projects* it where it cannot write it.

## 4. Market & Admin Errors

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x20` | 6013 | `MarketPaused` | `Market.is_paused` is set (by `pause_market`, component 10) and a **risk-increasing** instruction was called: `mint_position`, `deposit_collateral`, `lock_collateral`, `adapter_open_position`, `adapter_add_liquidity`. Exit paths (burn / settle / withdraw / unlock / adapter close+remove) never raise it. |
| `0x21` | 6014 | `PoolNotAllowlisted` | The Whirlpool is not `GlobalConfig.allowlisted_whirlpool`. |
| `0x30` | 6015 | `Unauthorized` | Caller is not the `GlobalConfig` admin (`create_market`, `pause_market`, `unpause_market`, `set_market_risk_params`), or a non-owner tried to settle a **short** (long settle is permissionless). |
| `0x31` | 6016 | `MarketAlreadyExists` | Documented mapping; Anchor's `init` rejects the duplicate before this is reached. |
| `0x32` | 6017 | `InvalidAllowlistEntry` | The allowlist entry is the default pubkey. |
| `0x33` | 6030 | `InvalidWhirlpoolAccount` | The Whirlpool account failed to deserialize (wrong size or discriminator). |
| `0x34` | 6029 | `MathOverflow` | Checked arithmetic wrapped. |

## 5. CLMM Adapter Errors (Orca CPI)

Raised by the adapter, almost always **before** the CPI is issued. See [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) §C.7–§C.8. **Orca's own errors are not mapped**: an unmapped Whirlpool error propagates raw (e.g. `0x1775 ClosePositionNotEmpty`, `0x177c LiquidityZero` in the regression guards).

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x40` | 6018 | `WrongWhirlpoolProgram` | CPI target is not the pinned Whirlpool program ID. |
| `0x41` | 6019 | `WhirlpoolNotAllowlisted` | The Whirlpool account is not the market's allowlisted pool. |
| `0x42` | 6020 | `TickArrayNotInitialized` | A required TickArray does not exist, or the passed account does not match the PDA derived from the tick it serves. |
| `0x43` | 6021 | `TickNotAlignedToSpacing` | A tick boundary is not a multiple of `tick_spacing`. |
| `0x44` | 6022 | `TickOutOfBounds` | A tick lies outside `±443636`. |
| `0x45` | 6023 | `PositionAuthorityMismatch` | `position_authority` / `orca_position` / `position_mint` do not match the expected PDA or stored key. |
| `0x46` | 6024 | `UnexpectedRemainingAccounts` | Remaining accounts supplied on a path that takes none (short mint, adapter harness). Long mint and withdraw *do* take them — the open-long set — and raise `MissingOpenLong` instead. |
| `0x47` | 6025 | `SlippageExceeded` | Actual token amounts breached `token_max_*` / `token_min_*`. |
| `0x48` | 6026 | `ClosePositionNotEmpty` | Close attempted while liquidity or fees remain on the Orca position. |

## 6. Risk & Solvency Errors — component 09

Appended to `PermaError` (so nothing above shifted). See [`09-risk-solvency.md`](../02-mvp-components/09-risk-solvency.md) and [ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md).

| Label | On-chain | Name | Description |
|---|---|---|---|
| `0x22` | 6031 | `InsolventMint` | Free USDC cannot cover existing long liability + `required_margin(L)` for the new long. |
| `0x24` | 6032 | `MissingOpenLong` | Remaining accounts are not exactly the user's open longs (`count != open_longs`, or an account failed validation). |
| `0x25` | 6033 | `TooManyOpenLongs` | `open_longs == MAX_OPEN_LONGS` (8). |
| `0x35` | 6034 | `InvalidRiskParams` | `set_market_risk_params` (component 10) rejected: zero horizon or buffer, or the margin at `risk::MARGIN_LIQUIDITY_BOUND` × `MAX_OPEN_LONGS` would overflow `u64` and brick withdraws (ADR-0003). Nothing written. |

## 7. Deferred — not defined, not raised

| Name | Status |
|---|---|
| `OracleDeviationTooHigh` | **Protocol V1.** Orca Whirlpool exposes no TWAP (`orca_whirlpools_client` 8.0.0 has no observation array; the `Oracle` PDA is adaptive-fee state). Fair MVP solvency reads no price ([ADR-0003](../adr/ADR-0003-fair-mvp-risk-model.md)), so there is no deviation to check. Reserved for a design with an external price source. |
| `CPIFailure` | Not defined. Orca errors propagate unmapped (see §5). |
| `AccountNotInitialized` | Not a PERMA error — it is Anchor's own `3012` (`0xbc4`), raised when a required account has no data. |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
