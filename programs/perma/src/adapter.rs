//! CLMM Adapter (Orca Whirlpool).
//!
//! The only module permitted to CPI into Orca. Spec:
//! `docs/02-mvp-components/01-clmm-adapter-orca.md`.
//!
//! CPI goes through `orca_whirlpools_client` v8 (code-generated from the pinned
//! program commit `408c945fef4c49ab70def4303377cfaf8f0f3c99`), **not** the
//! whirlpool program crate - see `docs/audits/IMPL-01-FEASIBILITY.md` section 3
//! and the ADR-0001 addendum.

use anchor_lang::prelude::*;
use orca_whirlpools_client::{
    get_tick_array_address, ClosePositionCpi, ClosePositionCpiAccounts, CollectFeesV2Cpi,
    CollectFeesV2CpiAccounts, CollectFeesV2InstructionArgs, DecreaseLiquidityV2Cpi,
    DecreaseLiquidityV2CpiAccounts, DecreaseLiquidityV2InstructionArgs, IncreaseLiquidityV2Cpi,
    IncreaseLiquidityV2CpiAccounts, IncreaseLiquidityV2InstructionArgs, OpenPositionCpi,
    OpenPositionCpiAccounts, OpenPositionInstructionArgs, Whirlpool, WHIRLPOOL_ID,
};

use crate::errors::PermaError;
use crate::state::Market;

// --- Orca constants, mirrored from the pinned commit ---------------------
// programs/whirlpool/src/state/tick_array.rs, state/tick.rs

/// Initializable ticks per TickArray.
pub const TICK_ARRAY_SIZE: i32 = 88;
pub const MIN_TICK_INDEX: i32 = -443_636;
pub const MAX_TICK_INDEX: i32 = 443_636;

/// The Whirlpool program ID, re-exported so callers never hardcode it.
pub fn whirlpool_program_id() -> Pubkey {
    WHIRLPOOL_ID
}

// --- Tick math -----------------------------------------------------------

/// Number of ticks one TickArray spans for a given spacing.
#[inline]
pub fn ticks_in_array(tick_spacing: u16) -> i32 {
    TICK_ARRAY_SIZE * tick_spacing as i32
}

/// Start tick index of the TickArray containing `tick_index`.
///
/// Uses [`i32::div_euclid`] deliberately. Rust's `/` truncates toward zero,
/// which returns the **wrong array** for negative ticks - and the entire
/// SOL/USDC range is negative. For the allowlisted pool (`tick_spacing = 8`,
/// `ticks_in_array = 704`), tick `-40176` floors to `-40832` but truncates to
/// `-40128`. Covered by [`tests::div_euclid_not_truncation`].
#[inline]
pub fn start_tick_index(tick_index: i32, tick_spacing: u16) -> Result<i32> {
    let n = ticks_in_array(tick_spacing);
    require!(n > 0, PermaError::MathOverflow);
    Ok(tick_index.div_euclid(n).checked_mul(n).ok_or(PermaError::MathOverflow)?)
}

/// Derive the TickArray PDA serving `tick_index`.
///
/// Seeds are `[b"tick_array", whirlpool, start_tick_index.to_string()]` - the
/// **decimal ASCII string**, not `to_le_bytes()`. Delegated to the generated
/// client so the seed rule cannot drift from Orca's own implementation.
pub fn derive_tick_array(whirlpool: &Pubkey, tick_index: i32, tick_spacing: u16) -> Result<Pubkey> {
    let start = start_tick_index(tick_index, tick_spacing)?;
    let (addr, _bump) =
        get_tick_array_address(whirlpool, start, None).map_err(|_| PermaError::TickArrayNotInitialized)?;
    Ok(addr)
}

/// True when `tick_index` is usable for a position boundary on this pool.
#[inline]
pub fn is_usable_tick(tick_index: i32, tick_spacing: u16) -> bool {
    (MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_index)
        && tick_index % tick_spacing as i32 == 0
}

// --- Pool reads ----------------------------------------------------------

/// Deserialize the live Whirlpool account.
pub fn load_whirlpool(info: &AccountInfo) -> Result<Whirlpool> {
    let data = info.try_borrow_data()?;
    Whirlpool::from_bytes(&data).map_err(|_| PermaError::InvalidWhirlpoolAccount.into())
}

/// Current `sqrt_price` as Q64.64.
///
/// Instantaneous and manipulable within a transaction: use for range gating and
/// display **only**, never as a settlement price. See spec section E.
pub fn get_sqrt_price_x64(whirlpool: &Whirlpool) -> u128 {
    whirlpool.sqrt_price
}

/// Current tick. Same caveat as [`get_sqrt_price_x64`].
pub fn get_current_tick(whirlpool: &Whirlpool) -> i32 {
    whirlpool.tick_current_index
}

// --- Pre-CPI validation --------------------------------------------------

/// Everything that must hold before any Orca CPI is issued (spec section C.8).
///
/// Returns the derived TickArray addresses so callers cannot re-derive them
/// differently.
#[allow(clippy::too_many_arguments)]
pub fn validate_before_cpi<'a>(
    market: &Market,
    whirlpool_program: &AccountInfo<'a>,
    whirlpool_info: &AccountInfo<'a>,
    whirlpool: &Whirlpool,
    position_authority: &Pubkey,
    market_authority: &Pubkey,
    tick_lower: i32,
    tick_upper: i32,
    tick_array_lower: &AccountInfo<'a>,
    tick_array_upper: &AccountInfo<'a>,
    remaining_accounts: &[AccountInfo<'a>],
) -> Result<()> {
    // 1. Program identity.
    require_keys_eq!(
        whirlpool_program.key(),
        WHIRLPOOL_ID,
        PermaError::WrongWhirlpoolProgram
    );

    // 2. Market allowlist - exactly one pool in Fair MVP.
    require!(
        market.is_allowlisted(&whirlpool_info.key()),
        PermaError::WhirlpoolNotAllowlisted
    );

    // 3. Pool internals match what the Market recorded.
    require_keys_eq!(whirlpool.token_mint_a, market.token_mint_a, PermaError::InvalidAsset);
    require_keys_eq!(whirlpool.token_mint_b, market.token_mint_b, PermaError::InvalidAsset);
    require_keys_eq!(whirlpool.token_vault_a, market.token_vault_a, PermaError::InvalidAsset);
    require_keys_eq!(whirlpool.token_vault_b, market.token_vault_b, PermaError::InvalidAsset);
    require_keys_eq!(
        whirlpool.whirlpools_config,
        market.whirlpools_config,
        PermaError::InvalidAsset
    );

    // 4. Tick validity. Spacing is read from the LIVE pool, never hardcoded.
    let spacing = whirlpool.tick_spacing;
    require!(tick_lower < tick_upper, PermaError::InvalidRange);
    require!(
        (MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_lower)
            && (MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick_upper),
        PermaError::TickOutOfBounds
    );
    require!(
        tick_lower % spacing as i32 == 0 && tick_upper % spacing as i32 == 0,
        PermaError::TickNotAlignedToSpacing
    );

    // 5. TickArray PDAs match the ticks actually being used, and exist.
    //    Only lower + upper are needed for liquidity ops - no "current" array.
    //    They may legitimately be the same account for a narrow range.
    for (tick, info) in [(tick_lower, tick_array_lower), (tick_upper, tick_array_upper)] {
        let expected = derive_tick_array(&whirlpool_info.key(), tick, spacing)?;
        require_keys_eq!(info.key(), expected, PermaError::TickArrayNotInitialized);
        require!(
            !info.data_is_empty() && info.owner == &WHIRLPOOL_ID,
            PermaError::TickArrayNotInitialized
        );
    }

    // 6. Only a PERMA PDA may control the Orca position.
    require_keys_eq!(
        *position_authority,
        *market_authority,
        PermaError::PositionAuthorityMismatch
    );

    // 7. RemainingAccountsInfo is Orca's transfer-hook channel. SOL/USDC have
    //    no hooks, so MVP passes None and refuses caller-injected accounts.
    require!(
        remaining_accounts.is_empty(),
        PermaError::UnexpectedRemainingAccounts
    );

    Ok(())
}

// --- Adapter results -----------------------------------------------------

/// Observed effect of a liquidity operation. Amounts are **measured vault
/// deltas**, never the caller's quote.
#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize)]
pub struct LiquidityDelta {
    pub liquidity: u128,
    pub amount_a: u64,
    pub amount_b: u64,
}

// --- CPI wrappers --------------------------------------------------------

/// Accounts for `open_position` (10 accounts).
///
/// `owner` is the account that will hold the position NFT. It is an
/// `UncheckedAccount` on Orca's side and needs **no signature**, so PERMA can
/// set it to the `market_authority` PDA at creation time - which is what makes
/// every later `position_authority` check pass (ADR-0001).
pub struct OpenPositionAccounts<'a, 'b> {
    pub whirlpool_program: &'b AccountInfo<'a>,
    pub funder: &'b AccountInfo<'a>,
    pub owner: &'b AccountInfo<'a>,
    pub position: &'b AccountInfo<'a>,
    pub position_mint: &'b AccountInfo<'a>,
    pub position_token_account: &'b AccountInfo<'a>,
    pub whirlpool: &'b AccountInfo<'a>,
    pub token_program: &'b AccountInfo<'a>,
    pub system_program: &'b AccountInfo<'a>,
    pub rent: &'b AccountInfo<'a>,
    pub associated_token_program: &'b AccountInfo<'a>,
}

/// Create the Orca position for a new short: CPI `open_position`.
///
/// Not PDA-signed - `funder` and `position_mint` are the signers, both supplied
/// by the client. The resulting NFT lands in an ATA owned by `owner`.
pub fn open_position_for_short<'a, 'b>(
    accs: &OpenPositionAccounts<'a, 'b>,
    position_bump: u8,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    OpenPositionCpi::new(
        accs.whirlpool_program,
        OpenPositionCpiAccounts {
            funder: accs.funder,
            owner: accs.owner,
            position: accs.position,
            position_mint: accs.position_mint,
            position_token_account: accs.position_token_account,
            whirlpool: accs.whirlpool,
            token_program: accs.token_program,
            system_program: accs.system_program,
            rent: accs.rent,
            associated_token_program: accs.associated_token_program,
        },
        OpenPositionInstructionArgs {
            position_bump,
            tick_lower_index,
            tick_upper_index,
        },
    )
    .invoke()?;
    Ok(())
}

/// Accounts for `close_position` (6 accounts).
///
/// Distinct from every other struct here: no whirlpool, no mints, no vaults.
pub struct ClosePositionAccounts<'a, 'b> {
    pub whirlpool_program: &'b AccountInfo<'a>,
    pub position_authority: &'b AccountInfo<'a>,
    pub receiver: &'b AccountInfo<'a>,
    pub position: &'b AccountInfo<'a>,
    pub position_mint: &'b AccountInfo<'a>,
    pub position_token_account: &'b AccountInfo<'a>,
    pub token_program: &'b AccountInfo<'a>,
}

/// Burn the position NFT and reclaim rent. **Step 3 of 3** on the full-close path.
///
/// Orca refuses this unless the position is completely empty - zero liquidity,
/// zero `fee_owed_a/b`, zero reward amounts - otherwise `ClosePositionNotEmpty`
/// (`0x1775`). PDA-signed, because `position_authority` is `market_authority`.
pub fn close_position_for_short<'a, 'b>(
    accs: &ClosePositionAccounts<'a, 'b>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    ClosePositionCpi::new(
        accs.whirlpool_program,
        ClosePositionCpiAccounts {
            position_authority: accs.position_authority,
            receiver: accs.receiver,
            position: accs.position,
            position_mint: accs.position_mint,
            position_token_account: accs.position_token_account,
            token_program: accs.token_program,
        },
    )
    .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Accounts shared by `increase_liquidity_v2` and `decrease_liquidity_v2`
/// (Orca's `ModifyLiquidityV2`, 15 accounts, order fixed by the generated client).
pub struct ModifyLiquidityAccounts<'a, 'b> {
    pub whirlpool_program: &'b AccountInfo<'a>,
    pub whirlpool: &'b AccountInfo<'a>,
    pub token_program_a: &'b AccountInfo<'a>,
    pub token_program_b: &'b AccountInfo<'a>,
    pub memo_program: &'b AccountInfo<'a>,
    pub position_authority: &'b AccountInfo<'a>,
    pub position: &'b AccountInfo<'a>,
    pub position_token_account: &'b AccountInfo<'a>,
    pub token_mint_a: &'b AccountInfo<'a>,
    pub token_mint_b: &'b AccountInfo<'a>,
    pub token_owner_account_a: &'b AccountInfo<'a>,
    pub token_owner_account_b: &'b AccountInfo<'a>,
    pub token_vault_a: &'b AccountInfo<'a>,
    pub token_vault_b: &'b AccountInfo<'a>,
    pub tick_array_lower: &'b AccountInfo<'a>,
    pub tick_array_upper: &'b AccountInfo<'a>,
}

/// Add liquidity for a short: CPI `increase_liquidity_v2`.
///
/// `remaining_accounts_info` is always `None` in Fair MVP (section E).
pub fn add_liquidity_for_short<'a, 'b>(
    accs: &ModifyLiquidityAccounts<'a, 'b>,
    liquidity_amount: u128,
    token_max_a: u64,
    token_max_b: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    IncreaseLiquidityV2Cpi::new(
        accs.whirlpool_program,
        IncreaseLiquidityV2CpiAccounts {
            whirlpool: accs.whirlpool,
            token_program_a: accs.token_program_a,
            token_program_b: accs.token_program_b,
            memo_program: accs.memo_program,
            position_authority: accs.position_authority,
            position: accs.position,
            position_token_account: accs.position_token_account,
            token_mint_a: accs.token_mint_a,
            token_mint_b: accs.token_mint_b,
            token_owner_account_a: accs.token_owner_account_a,
            token_owner_account_b: accs.token_owner_account_b,
            token_vault_a: accs.token_vault_a,
            token_vault_b: accs.token_vault_b,
            tick_array_lower: accs.tick_array_lower,
            tick_array_upper: accs.tick_array_upper,
        },
        IncreaseLiquidityV2InstructionArgs {
            liquidity_amount,
            token_max_a,
            token_max_b,
            remaining_accounts_info: None,
        },
    )
    .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Remove liquidity for a short: CPI `decrease_liquidity_v2`.
///
/// This is **step 1 of 3** on the full-close path. Callers must follow with
/// [`collect_fees_for_short`] then `close_position`; see
/// [`remove_liquidity_for_short`] for why the order is not negotiable.
pub fn decrease_liquidity_for_short<'a, 'b>(
    accs: &ModifyLiquidityAccounts<'a, 'b>,
    liquidity_amount: u128,
    token_min_a: u64,
    token_min_b: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    DecreaseLiquidityV2Cpi::new(
        accs.whirlpool_program,
        DecreaseLiquidityV2CpiAccounts {
            whirlpool: accs.whirlpool,
            token_program_a: accs.token_program_a,
            token_program_b: accs.token_program_b,
            memo_program: accs.memo_program,
            position_authority: accs.position_authority,
            position: accs.position,
            position_token_account: accs.position_token_account,
            token_mint_a: accs.token_mint_a,
            token_mint_b: accs.token_mint_b,
            token_owner_account_a: accs.token_owner_account_a,
            token_owner_account_b: accs.token_owner_account_b,
            token_vault_a: accs.token_vault_a,
            token_vault_b: accs.token_vault_b,
            tick_array_lower: accs.tick_array_lower,
            tick_array_upper: accs.tick_array_upper,
        },
        DecreaseLiquidityV2InstructionArgs {
            liquidity_amount,
            token_min_a,
            token_min_b,
            remaining_accounts_info: None,
        },
    )
    .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Accounts for `collect_fees_v2` (13 accounts).
///
/// **The order differs from `ModifyLiquidityV2`**: owner/vault are interleaved
/// per token and the programs come last. Never build this list by analogy - it
/// is a distinct struct for that reason.
pub struct CollectFeesAccounts<'a, 'b> {
    pub whirlpool_program: &'b AccountInfo<'a>,
    pub whirlpool: &'b AccountInfo<'a>,
    pub position_authority: &'b AccountInfo<'a>,
    pub position: &'b AccountInfo<'a>,
    pub position_token_account: &'b AccountInfo<'a>,
    pub token_mint_a: &'b AccountInfo<'a>,
    pub token_mint_b: &'b AccountInfo<'a>,
    pub token_owner_account_a: &'b AccountInfo<'a>,
    pub token_vault_a: &'b AccountInfo<'a>,
    pub token_owner_account_b: &'b AccountInfo<'a>,
    pub token_vault_b: &'b AccountInfo<'a>,
    pub token_program_a: &'b AccountInfo<'a>,
    pub token_program_b: &'b AccountInfo<'a>,
    pub memo_program: &'b AccountInfo<'a>,
}

/// Drain accrued Whirlpool fees. **Step 2 of 3** on the full-close path.
pub fn collect_fees_for_short<'a, 'b>(
    accs: &CollectFeesAccounts<'a, 'b>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    CollectFeesV2Cpi::new(
        accs.whirlpool_program,
        CollectFeesV2CpiAccounts {
            whirlpool: accs.whirlpool,
            position_authority: accs.position_authority,
            position: accs.position,
            position_token_account: accs.position_token_account,
            token_mint_a: accs.token_mint_a,
            token_mint_b: accs.token_mint_b,
            token_owner_account_a: accs.token_owner_account_a,
            token_vault_a: accs.token_vault_a,
            token_owner_account_b: accs.token_owner_account_b,
            token_vault_b: accs.token_vault_b,
            token_program_a: accs.token_program_a,
            token_program_b: accs.token_program_b,
            memo_program: accs.memo_program,
        },
        CollectFeesV2InstructionArgs {
            remaining_accounts_info: None,
        },
    )
    .invoke_signed(signer_seeds)?;
    Ok(())
}

/// Full close: `decrease_liquidity_v2` -> `collect_fees_v2`. The caller issues
/// `close_position` last.
///
/// **Exactly three steps, in this order.** Two Orca behaviours make any other
/// ordering fail:
///
/// - Inserting `update_fees_and_rewards` between decrease and collect returns
///   `LiquidityZero` (`0x177c`): Orca's `_calculate_modify_liquidity` rejects
///   `liquidity_delta == 0 && position.liquidity == 0`, which is exactly the
///   post-decrease state. `decrease_liquidity` already refreshes fee growth.
/// - Skipping `collect_fees_v2` makes `close_position` fail with
///   `ClosePositionNotEmpty` (`0x1775`), because fees remain owed.
pub fn remove_liquidity_for_short<'a, 'b>(
    modify: &ModifyLiquidityAccounts<'a, 'b>,
    collect: &CollectFeesAccounts<'a, 'b>,
    liquidity_amount: u128,
    token_min_a: u64,
    token_min_b: u64,
    close_after: bool,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Step 1 - skipped for a zero amount. Orca's `_calculate_modify_liquidity`
    // rejects `liquidity_delta == 0 && position.liquidity == 0` with
    // `LiquidityZero` (0x177c), so a "collect and close only" call must not
    // issue a pointless decrease.
    if liquidity_amount > 0 {
        decrease_liquidity_for_short(
            modify,
            liquidity_amount,
            token_min_a,
            token_min_b,
            signer_seeds,
        )?;
    }

    // Step 2 - only on a full close. A partial remove leaves the position open,
    // so fees may stay accrued.
    if close_after {
        collect_fees_for_short(collect, signer_seeds)?;
    }
    Ok(())
}

// --- Unit tests ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The allowlisted devnet pool.
    const SPACING: u16 = 8;

    #[test]
    fn ticks_in_array_matches_pool() {
        // 88 * 8 = 704 for the allowlisted pool - NOT the 5632 of a
        // tick_spacing-64 pool used in the spec's illustrative example.
        assert_eq!(ticks_in_array(SPACING), 704);
        assert_eq!(ticks_in_array(64), 5632);
    }

    #[test]
    fn start_tick_index_live_pool_values() {
        // Demo range $18-$22 on the allowlisted pool (WSOL 9dp / devUSDC 6dp).
        assert_eq!(start_tick_index(-40176, SPACING).unwrap(), -40832);
        assert_eq!(start_tick_index(-38168, SPACING).unwrap(), -38720);
        // Live tick at selection time.
        assert_eq!(start_tick_index(-39140, SPACING).unwrap(), -39424);
        // Exact multiples are their own start.
        assert_eq!(start_tick_index(-39424, SPACING).unwrap(), -39424);
        assert_eq!(start_tick_index(0, SPACING).unwrap(), 0);
    }

    /// The highest-risk detail in the whole integration.
    #[test]
    fn div_euclid_not_truncation() {
        let n = ticks_in_array(SPACING);
        for tick in [-40176_i32, -38168, -39140, -1, -703] {
            let truncated = (tick / n) * n;
            let floored = start_tick_index(tick, SPACING).unwrap();
            assert_ne!(
                truncated, floored,
                "truncating division must differ from div_euclid at tick {tick}"
            );
            assert!(floored <= tick, "start must not exceed its tick");
            assert!(tick - floored < n, "tick must fall inside its own array");
        }
        // Positive ticks and exact multiples agree under both.
        assert_eq!((704 / n) * n, start_tick_index(704, SPACING).unwrap());
    }

    #[test]
    fn start_tick_index_is_always_a_valid_array_start() {
        let n = ticks_in_array(SPACING);
        for tick in [-443_600_i32, -40176, -1, 0, 1, 40176, 443_600] {
            let start = start_tick_index(tick, SPACING).unwrap();
            assert_eq!(start % n, 0, "start {start} must be a multiple of {n}");
        }
    }

    #[test]
    fn usable_tick_rules() {
        assert!(is_usable_tick(-40176, SPACING)); // multiple of 8
        assert!(!is_usable_tick(-40175, SPACING)); // not aligned
        assert!(!is_usable_tick(MIN_TICK_INDEX - 1, SPACING)); // out of bounds
        assert!(!is_usable_tick(MAX_TICK_INDEX + 1, SPACING));
        // Alignment is spacing-relative, not absolute.
        assert!(is_usable_tick(-40176, 16));
        assert!(!is_usable_tick(-40168, 16));
    }

    #[test]
    fn tick_array_seeds_are_decimal_ascii_not_le_bytes() {
        let whirlpool = Pubkey::new_unique();
        let start = -40832_i32;

        let (expected, _) = get_tick_array_address(&whirlpool, start, None).unwrap();

        // What the client (and Orca) actually do: decimal ASCII.
        let (ascii, _) = Pubkey::find_program_address(
            &[b"tick_array", whirlpool.as_ref(), start.to_string().as_bytes()],
            &WHIRLPOOL_ID,
        );
        assert_eq!(ascii, expected);

        // The classic mistake: little-endian bytes. Valid-looking, wrong address.
        let (le, _) = Pubkey::find_program_address(
            &[b"tick_array", whirlpool.as_ref(), &start.to_le_bytes()],
            &WHIRLPOOL_ID,
        );
        assert_ne!(le, expected, "to_le_bytes() must NOT match the real PDA");
    }

    #[test]
    fn narrow_range_shares_one_tick_array() {
        // Both bounds inside array -39424: passing the same pubkey twice is legal.
        let lower = start_tick_index(-39184, SPACING).unwrap();
        let upper = start_tick_index(-39104, SPACING).unwrap();
        assert_eq!(lower, upper);
        assert_eq!(lower, -39424);
    }

    #[test]
    fn wide_range_spans_distinct_tick_arrays() {
        let lower = start_tick_index(-40176, SPACING).unwrap();
        let upper = start_tick_index(-38168, SPACING).unwrap();
        assert_ne!(lower, upper, "demo range must exercise the two-array path");
    }
}
