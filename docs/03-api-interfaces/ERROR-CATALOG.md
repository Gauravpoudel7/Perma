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
| `0x32` | `CPIFailure` | The underlying CLMM program returned an error. |

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
