//! PERMA error codes.
//!
//! Numbering follows `docs/03-api-interfaces/ERROR-CATALOG.md`. Only the
//! adapter-relevant subset (catalog section 5, `0x40`-`0x48`) is implemented in
//! this component; the rest land with components 02-11.

use anchor_lang::prelude::*;

#[error_code]
pub enum PermaError {
    // --- Section 1: Collateral (component 03) ---
    /// `0x01` - not enough free balance for the requested action.
    #[msg("Insufficient free collateral for this action")]
    InsufficientFunds,

    /// `0x02` - withdrawal would breach an outstanding obligation.
    ///
    /// Component 03 enforces only the premium-seniority half of this: free USDC
    /// may not drop below `premium_owed_usdc`. Full
    /// `AccountValue >= RequiredCollateral` arrives with component 09.
    #[msg("Withdrawal would leave open obligations uncovered")]
    InsolventWithdrawal,

    /// `0x53` - premium debit exceeds free USDC. Premium is a senior claim and
    /// is never taken from `locked_*` (ADR-0002).
    #[msg("Collateral cannot cover the premium owed")]
    InsufficientCollateralForLoss,

    /// Unlock attempted while short positions still rely on the locked funds.
    #[msg("Cannot unlock collateral while positions are open")]
    PositionsOutstanding,

    /// `0x13` - `leg` is neither `SHORT` nor `LONG`.
    #[msg("Unknown leg type")]
    InvalidLegType,

    /// `0x12` - the position has already been burned.
    #[msg("Position is already closed")]
    PositionAlreadyClosed,

    /// `0x10` - no short liquidity available to sell a long against.
    ///
    /// Raised when the range has never had a short (so `RangePremiumState`
    /// does not exist) or when `total_short - total_long` is below the
    /// requested size.
    #[msg("Not enough available short liquidity in this range")]
    NoShortInventory,

    /// A short burn would leave `total_short_liquidity < total_long_liquidity`,
    /// i.e. longs backed by liquidity that no longer exists.
    #[msg("Short burn would leave longs without backing inventory")]
    InventoryInvariantViolated,

    /// The low-level `adapter_*` harness cannot be used on a range that has
    /// longs - it does not maintain range weights, so it would silently desync
    /// the inventory gate. Use `mint_position` / `burn_position`.
    #[msg("Harness path unavailable: this range has open longs")]
    HarnessPathUnavailable,

    /// `0x50` - settle called with nothing owed and nothing claimable.
    #[msg("Nothing to settle")]
    NothingToSettle,

    /// `0x51` - the supplied `RangePremiumState` does not match the position's
    /// tick range.
    #[msg("Range state does not match the position's ticks")]
    RangeStateMismatch,

    /// `0x52` - **defensive.** A claim exceeded the range bucket's capacity to
    /// account for it. Should be unreachable; indicates an accounting bug.
    #[msg("Premium pool underfunded for this claim")]
    PremiumPoolUnderfunded,

    /// Deposit or withdraw of zero on both sides.
    #[msg("Amount must be non-zero")]
    ZeroAmount,

    /// The market is paused; collateral movement is halted.
    #[msg("Market is paused")]
    MarketPaused,

    // --- Section 3: Market & Risk (component 02) ---
    /// `0x21` - the requested pool is not the allowlisted Whirlpool.
    #[msg("The requested CLMM pool is not approved for PERMA")]
    PoolNotAllowlisted,

    /// `0x30` - caller is not the `GlobalConfig` admin.
    #[msg("The caller does not have the required admin privileges")]
    Unauthorized,

    /// A `Market` already exists for this pool.
    ///
    /// Anchor's `init` constraint catches this first and surfaces its own
    /// account-already-in-use error, so this variant is the **documented
    /// mapping** rather than a code the program raises itself. See
    /// `docs/audits/IMPL-02-FACTORY-REPORT.md`.
    #[msg("A market already exists for this pool")]
    MarketAlreadyExists,

    /// Allowlist was given the default (all-zero) pubkey.
    #[msg("Allowlisted whirlpool must not be the default pubkey")]
    InvalidAllowlistEntry,

    // --- Section 5: CLMM Adapter (Orca CPI) ---
    /// `0x40` - CPI target is not the pinned Whirlpool program ID.
    #[msg("CPI target is not the Orca Whirlpool program")]
    WrongWhirlpoolProgram,

    /// `0x41` - Whirlpool account is not the market's allowlisted pool.
    #[msg("Whirlpool is not the allowlisted market pool")]
    WhirlpoolNotAllowlisted,

    /// `0x42` - TickArray missing, or the passed account does not match the
    /// PDA derived from the tick it serves.
    #[msg("Required TickArray is not initialized or does not match its derived PDA")]
    TickArrayNotInitialized,

    /// `0x43` - Tick boundary is not a multiple of the pool's `tick_spacing`.
    #[msg("Tick is not aligned to the pool tick spacing")]
    TickNotAlignedToSpacing,

    /// `0x44` - Tick outside `MIN_TICK_INDEX..=MAX_TICK_INDEX`.
    #[msg("Tick index is out of bounds")]
    TickOutOfBounds,

    /// `0x45` - `position_authority` is not the `market_authority` PDA.
    #[msg("Orca position authority must be the PERMA market authority PDA")]
    PositionAuthorityMismatch,

    /// `0x46` - Caller supplied remaining accounts; MVP requires zero.
    #[msg("Unexpected remaining accounts supplied")]
    UnexpectedRemainingAccounts,

    /// `0x47` - Actual token amounts breached the slippage caps.
    #[msg("Slippage bounds exceeded")]
    SlippageExceeded,

    /// `0x48` - Close attempted with liquidity or fees outstanding.
    #[msg("Orca position is not empty; run decrease -> collect_fees -> close")]
    ClosePositionNotEmpty,

    // --- Adapter-local validation ---
    /// `tick_lower >= tick_upper`.
    #[msg("Invalid tick range: lower must be strictly less than upper")]
    InvalidRange,

    /// Mint or vault on the Whirlpool does not match the Market record.
    #[msg("Whirlpool asset does not match the market configuration")]
    InvalidAsset,

    /// Arithmetic overflow in tick or liquidity math.
    #[msg("Arithmetic overflow")]
    MathOverflow,

    /// The Whirlpool account could not be deserialized.
    #[msg("Failed to deserialize the Whirlpool account")]
    InvalidWhirlpoolAccount,

    // --- Component 09 (appended; on-chain codes 6031+) ---
    /// `0x22` - free USDC cannot cover existing long liability plus the
    /// margin for the new long (ADR-0003).
    #[msg("Insufficient free USDC to back this long")]
    InsolventMint,
    /// `0x24` - the remaining accounts are not exactly this user's open longs.
    #[msg("Remaining accounts must be exactly the user's open longs")]
    MissingOpenLong,
    /// `0x25` - `UserCollateral.open_longs == MAX_OPEN_LONGS`.
    #[msg("Too many open longs")]
    TooManyOpenLongs,
    /// `0x35` - `set_market_risk_params` rejected: zero horizon/buffer, or the
    /// margin for `risk::MARGIN_LIQUIDITY_BOUND` (×`MAX_OPEN_LONGS`) would
    /// overflow `u64` and brick withdraws (ADR-0003 forward requirement).
    #[msg("Risk parameters would overflow the margin bound")]
    InvalidRiskParams,
}
