# ERROR CATALOG: PERMA

This document lists the standard error codes returned by the PERMA program. All errors are defined in the Anchor `ErrorCode` enum.

## 1. Collateral Errors

| Code | Name | Description |
|---|---|---|
| `0x01` | `InsufficientFunds` | User does not have enough collateral to perform the action. |
| `0x02` | `InsolventWithdrawal` | Withdrawal would leave the user's open positions under-collateralized. |
| `0x03` | `InvalidAsset` | The token provided is not the allowlisted SOL or USDC. |

## 2. Position Errors

| Code | Name | Description |
|---|---|---|
| `0x10` | `NoShortInventory` | Attempting to open a Long where no short liquidity exists. |
| `0x11` | `InvalidRange` | The tick range is invalid or exceeds pool boundaries. |
| `0x12` | `PositionAlreadyClosed` | Attempting to interact with a position that is already burned. |
| `0x13` | `InvalidLegType` | The requested leg is not supported in the current market. |

## 3. Market & Risk Errors

| Code | Name | Description |
|---|---|---|
| `0x20` | `MarketPaused` | The market is currently halted by the admin. |
| `0x21` | `PoolNotAllowlisted` | The requested CLMM pool is not approved for PERMA. |
| `0x22` | `InsolventMint` | User does not have enough buying power to open this position. |
| `0x23` | `OracleDeviationTooHigh` | The spot price deviates too much from the TWAP; transaction rejected. |

## 4. System Errors

| Code | Name | Description |
|---|---|---|
| `0x30` | `Unauthorized` | The caller does not have the required admin privileges. |
| `0x31` | `AccountNotInitialized` | The target PDA has not been initialized. |
| `0x32` | `CPIFailure` | The underlying CLMM program returned an error. Raw Orca code is logged via `msg!` before mapping. |

## 5. CLMM Adapter Errors (Orca CPI)

Raised by the CLMM Adapter, almost always **before** the CPI is issued. See [`01-clmm-adapter-orca.md`](../02-mvp-components/01-clmm-adapter-orca.md) §C.7–§C.8 for the full trigger table and the Orca-side error codes each one shadows.

| Code | Name | Description |
|---|---|---|
| `0x40` | `WrongWhirlpoolProgram` | CPI target is not the pinned Whirlpool program ID. |
| `0x41` | `WhirlpoolNotAllowlisted` | The Whirlpool account is not the market's allowlisted pool. |
| `0x42` | `TickArrayNotInitialized` | A required TickArray does not exist, or the passed account does not match the PDA derived from the tick it serves. |
| `0x43` | `TickNotAlignedToSpacing` | A tick boundary is not a multiple of the pool's `tick_spacing`. |
| `0x44` | `TickOutOfBounds` | A tick lies outside `MIN_TICK_INDEX`/`MAX_TICK_INDEX` (`±443636`). |
| `0x45` | `PositionAuthorityMismatch` | `position_authority` is not the `market_authority` PDA. |
| `0x46` | `UnexpectedRemainingAccounts` | Caller supplied remaining accounts; MVP requires zero (no transfer hooks on SOL/USDC). |
| `0x47` | `SlippageExceeded` | Actual token amounts breached `token_max_*` / `token_min_*`. |
| `0x48` | `ClosePositionNotEmpty` | Close attempted while liquidity or fees remain on the Orca position. |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
