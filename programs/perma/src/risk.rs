//! Risk & Solvency - **component 09, Fair MVP** (ADR-0003).
//!
//! # What this is
//!
//! One question, answered in one place: *can this user's free USDC cover what
//! their open longs already owe, plus a margin for what they will owe next?*
//! Every path that could move free USDC out from under that obligation -
//! `withdraw_collateral` and `mint_position(LONG)` - asks it first.
//!
//! # What this is not
//!
//! - **Not a price-based engine.** Orca Whirlpool exposes spot only; there is
//!   no TWAP (`orca_whirlpools_client` 8.0.0 has no observation ring and the
//!   `Oracle` PDA is adaptive-fee state). Nothing here reads a price.
//! - **Not P&L.** A short's realized LP result is `returned − locked`, applied
//!   once by `position::close_short`. A long closes at P&L = 0.
//! - **Not liquidation.** An underwater long stays open with its debt standing.
//!
//! # Why the caller passes the longs
//!
//! Accrual on an open long lives on the position (`entry_index`,
//! `accrued_scaled`) and advances with time, so no stored aggregate can be
//! trusted a slot later. The gate therefore reads the *actual* positions,
//! supplied as remaining accounts, and refuses unless their count matches
//! `UserCollateral.open_longs` exactly - so nobody can omit one. Rejected
//! alternative (ADR-0003 option 3b): a running per-user liability, which is a
//! second ledger of exactly the "number without a source" shape component 08
//! spent its whole scope removing.

use anchor_lang::prelude::*;

use crate::collateral::Side;
use crate::errors::PermaError;
use crate::premium::{payable_if_settled_now, PREMIUM_SCALE};
use crate::state::{leg_type, position_status, seeds, Market, PermaPosition, UserCollateral};

/// Upper bound on open longs per user per market.
///
/// Bounds the remaining-account list a withdraw has to carry. A base withdraw
/// is ~10 accounts; +32 B per long keeps 8 comfortably inside the 1232-byte
/// transaction limit (measured in Phase 1). Enforced in `mint_long_inner`.
pub const MAX_OPEN_LONGS: u16 = 8;

/// `ceil(horizon × rate × L × mult / PREMIUM_SCALE) + buffer`, in µUSDC.
///
/// Derived from the shipped premium formula, so the only invented number is
/// the horizon. **Rounds up** (protocol-conservative). Every product is checked;
/// a wrap fails `MathOverflow` rather than admitting a long with zero margin.
///
/// With `risk_defaults` this is `L + 1_000_000` exactly - see `state.rs`.
pub(crate) fn required_margin(market: &Market, liquidity: u128) -> Result<u64> {
    let scaled = (market.long_margin_horizon_slots as u128)
        .checked_mul(market.premium_rate as u128)
        .ok_or(PermaError::MathOverflow)?
        .checked_mul(liquidity)
        .ok_or(PermaError::MathOverflow)?
        .checked_mul(market.premium_multiplier as u128)
        .ok_or(PermaError::MathOverflow)?;
    let q = scaled / PREMIUM_SCALE;
    let r = scaled % PREMIUM_SCALE;
    let per_horizon = q + u128::from(r != 0);
    let total = per_horizon
        .checked_add(market.long_margin_buffer_usdc as u128)
        .ok_or(PermaError::MathOverflow)?;
    u64::try_from(total).map_err(|_| PermaError::MathOverflow.into())
}

/// Free USDC this user must keep: legacy `premium_owed_usdc` plus, for every
/// open long, what it would be charged if settled right now and its margin.
///
/// Pure over owned copies so it unit-tests without accounts. `projected` is
/// the index value at *now* - see `premium::projected_index`.
pub(crate) fn required_free_usdc(
    user: &UserCollateral,
    longs: &[PermaPosition],
    projected: u128,
    market: &Market,
) -> Result<u64> {
    let mut total = user.premium_owed_usdc as u128;
    for pos in longs {
        let owed = payable_if_settled_now(pos, projected, market)? as u128;
        let margin = required_margin(market, pos.liquidity)? as u128;
        total = total
            .checked_add(owed)
            .ok_or(PermaError::MathOverflow)?
            .checked_add(margin)
            .ok_or(PermaError::MathOverflow)?;
    }
    u64::try_from(total).map_err(|_| PermaError::MathOverflow.into())
}

/// Gate a withdrawal of `amount_a` WSOL and `amount_b` USDC.
///
/// Pure and side-effect free: callers run this *before* mutating anything.
/// `longs` must be the user's complete open-long set (see
/// [`collect_open_longs`]); with none, this reduces exactly to the component-03
/// behaviour - free covers the request, free USDC after ≥ `premium_owed_usdc`.
///
/// `locked_*` needs no check here - `withdraw_collateral` debits free balance
/// only, so locked funds are unreachable by construction.
pub(crate) fn check_withdraw_allowed(
    user: &UserCollateral,
    longs: &[PermaPosition],
    projected: u128,
    market: &Market,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    // 1. Free balance must cover the request on both sides.
    let _free_a_after = user
        .free(Side::A)
        .checked_sub(amount_a)
        .ok_or(PermaError::InsufficientFunds)?; // no WSOL-denominated obligation exists
    let free_b_after = user
        .free(Side::B)
        .checked_sub(amount_b)
        .ok_or(PermaError::InsufficientFunds)?;

    // 2. Premium is a senior claim: free USDC may never drop below what the
    //    user's longs owe now plus the margin for what they owe next.
    let required = required_free_usdc(user, longs, projected, market)?;
    require!(free_b_after >= required, PermaError::InsolventWithdrawal);
    Ok(())
}

/// Gate opening a new long of `new_liquidity`.
///
/// Runs *after* the inventory gate and the `MAX_OPEN_LONGS` bound, *before*
/// `position::open_long` increments the counter - so `longs` is the existing
/// set and the new long's margin is added explicitly.
pub(crate) fn check_long_mint_allowed(
    user: &UserCollateral,
    longs: &[PermaPosition],
    projected: u128,
    market: &Market,
    new_liquidity: u128,
) -> Result<()> {
    let existing = required_free_usdc(user, longs, projected, market)? as u128;
    let new_margin = required_margin(market, new_liquidity)? as u128;
    let required = existing
        .checked_add(new_margin)
        .ok_or(PermaError::MathOverflow)?;
    require!(
        (user.free(Side::B) as u128) >= required,
        PermaError::InsolventMint
    );
    Ok(())
}

/// Validate `remaining` as **the** full set of this user's open longs and
/// return owned copies.
///
/// Each account must: be owned by this program with the `PermaPosition`
/// discriminator (`Account::try_from` - never an unchecked deserialize, or a
/// `UserCollateral` byte pattern could be fed in), re-derive to its own PDA
/// from `(market, owner, nonce, bump)`, belong to this market and owner, be a
/// LONG, be `Open`, and appear once. Then the count must equal `expected` -
/// **in both directions**: fewer means the caller omitted one; more means the
/// counter drifted, and we fail closed rather than trust either side.
///
/// Why `count == expected` is sufficient: `expected` distinct, valid, open
/// longs out of exactly `expected` existing is the whole set. A closed long's
/// account no longer exists; `PendingPremium` is SHORT-only; and a long being
/// minted in this same instruction has no discriminator yet (Anchor writes it
/// at `exit()`), so it cannot be smuggled in.
pub(crate) fn collect_open_longs<'info>(
    remaining: &'info [AccountInfo<'info>],
    program_id: &Pubkey,
    market: &Pubkey,
    owner: &Pubkey,
    expected: u16,
) -> Result<Vec<PermaPosition>> {
    require!(
        remaining.len() == usize::from(expected),
        PermaError::MissingOpenLong
    );

    let mut seen: Vec<Pubkey> = Vec::with_capacity(remaining.len());
    let mut out: Vec<PermaPosition> = Vec::with_capacity(remaining.len());

    for info in remaining {
        require!(!seen.contains(info.key), PermaError::MissingOpenLong);
        seen.push(*info.key);

        let account = Account::<PermaPosition>::try_from(info)
            .map_err(|_| error!(PermaError::MissingOpenLong))?;
        let pos: &PermaPosition = &account;

        let expected_key = Pubkey::create_program_address(
            &[
                seeds::PERMA_POSITION,
                market.as_ref(),
                owner.as_ref(),
                &pos.nonce.to_le_bytes(),
                &[pos.bump],
            ],
            program_id,
        )
        .map_err(|_| error!(PermaError::MissingOpenLong))?;
        require_keys_eq!(*info.key, expected_key, PermaError::MissingOpenLong);

        require!(pos.market == *market, PermaError::MissingOpenLong);
        require!(pos.owner == *owner, PermaError::MissingOpenLong);
        require!(pos.leg_type == leg_type::LONG, PermaError::MissingOpenLong);
        require!(
            pos.status == position_status::OPEN,
            PermaError::MissingOpenLong
        );

        out.push(pos.clone());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{premium_defaults, risk_defaults};

    fn market() -> Market {
        Market {
            whirlpool: Pubkey::new_unique(),
            whirlpools_config: Pubkey::new_unique(),
            token_mint_a: Pubkey::new_unique(),
            token_mint_b: Pubkey::new_unique(),
            token_vault_a: Pubkey::new_unique(),
            token_vault_b: Pubkey::new_unique(),
            vault_a: Pubkey::new_unique(),
            vault_b: Pubkey::new_unique(),
            tick_spacing: 8,
            has_active_rewards: false,
            is_paused: false,
            authority_bump: 255,
            bump: 255,
            premium_rate: premium_defaults::PREMIUM_RATE,
            premium_multiplier: premium_defaults::PREMIUM_MULTIPLIER,
            long_margin_horizon_slots: risk_defaults::LONG_MARGIN_HORIZON_SLOTS,
            long_margin_buffer_usdc: risk_defaults::LONG_MARGIN_BUFFER_USDC,
        }
    }

    fn user(free_a: u64, free_b: u64) -> UserCollateral {
        UserCollateral {
            market: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            balance_a: free_a,
            locked_a: 0,
            balance_b: free_b,
            locked_b: 0,
            premium_owed_usdc: 0,
            open_positions: 0,
            bump: 255,
            open_longs: 0,
        }
    }

    fn long(liquidity: u128, entry_index: u128) -> PermaPosition {
        PermaPosition {
            market: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            orca_position: Pubkey::default(),
            position_mint: Pubkey::default(),
            tick_lower: -40176,
            tick_upper: -38168,
            liquidity,
            in_orca_a: 0,
            in_orca_b: 0,
            locked_a: 0,
            locked_b: 0,
            leg_type: leg_type::LONG,
            status: position_status::OPEN,
            entry_index,
            accrued_scaled: 0,
            entry_acc_q64: 0,
            premium_receivable: 0,
            nonce: 1,
            bump: 255,
        }
    }

    // --- required_margin ---------------------------------------------------

    /// At the demo defaults the horizon factor is exactly 1: margin == L + 1 USDC.
    #[test]
    fn margin_at_demo_defaults_is_liquidity_plus_buffer() {
        let m = market();
        assert_eq!(required_margin(&m, 1).unwrap(), 1_000_001);
        assert_eq!(required_margin(&m, 50_000_000).unwrap(), 51_000_000);
        assert_eq!(required_margin(&m, 0).unwrap(), 1_000_000, "buffer alone");
    }

    /// Rounding is UP: a horizon that does not divide evenly costs one more unit.
    #[test]
    fn margin_rounds_up_not_down() {
        let mut m = market();
        m.long_margin_horizon_slots = 1; // 1 × 1e6 × L × 1e3 / 1e12 = L / 1e3
        m.long_margin_buffer_usdc = 0;
        assert_eq!(required_margin(&m, 1_000).unwrap(), 1, "exact");
        assert_eq!(required_margin(&m, 1_001).unwrap(), 2, "1.001 -> 2");
        assert_eq!(required_margin(&m, 1).unwrap(), 1, "0.001 -> 1, never 0");
    }

    /// A product that wraps fails loudly instead of admitting a zero-margin long.
    #[test]
    fn margin_overflow_is_an_error_not_a_wrap() {
        let m = market();
        assert!(required_margin(&m, u128::MAX).is_err());
    }

    // --- required_free_usdc / gates ----------------------------------------

    /// With no longs the gate is exactly the component-03 behaviour.
    #[test]
    fn no_longs_reduces_to_the_legacy_check() {
        let m = market();
        let mut u = user(1_000, 1_000);
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 1_000, 1_000).is_ok());
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 1_001, 0).is_err());
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 0, 1_001).is_err());

        u.premium_owed_usdc = 400;
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 0, 600).is_ok());
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 0, 700).is_err());
    }

    #[test]
    fn locked_funds_do_not_count_as_withdrawable() {
        let m = market();
        let mut u = user(100, 0);
        u.locked_a = 900;
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 101, 0).is_err());
        assert!(check_withdraw_allowed(&u, &[], 0, &m, 100, 0).is_ok());
    }

    /// The whole point of 09: accrual on an OPEN long counts, even though
    /// nothing has been written to `premium_owed_usdc`.
    #[test]
    fn open_long_accrual_blocks_withdrawal() {
        let m = market();
        let l = long(50_000_000, 0);
        // 100 slots elapsed at the demo rate: projected index = 100 × 1e6.
        let projected = 100u128 * 1_000_000;
        // owed = 1e8 × 5e7 × 1e3 / 1e12 = 5_000_000; margin = 51_000_000.
        let required = required_free_usdc(&user(0, 0), &[l.clone()], projected, &m).unwrap();
        assert_eq!(required, 56_000_000);

        let u = user(0, 60_000_000);
        assert!(check_withdraw_allowed(&u, &[l.clone()], projected, &m, 0, 4_000_000).is_ok());
        assert!(
            check_withdraw_allowed(&u, &[l], projected, &m, 0, 4_000_001).is_err(),
            "one unit past the liability + margin is refused"
        );
    }

    /// R7: the liability is computed against the PROJECTED index, so a stale
    /// stored index cannot be exploited by withdrawing before a crank.
    #[test]
    fn projection_counts_uncranked_accrual() {
        let m = market();
        let l = long(50_000_000, 0);
        let stale = 0u128; // nobody has cranked since the long opened
        let fresh = 100u128 * 1_000_000;
        let at_stale = required_free_usdc(&user(0, 0), &[l.clone()], stale, &m).unwrap();
        let at_fresh = required_free_usdc(&user(0, 0), &[l], fresh, &m).unwrap();
        assert_eq!(at_stale, 51_000_000, "margin only");
        assert_eq!(at_fresh, 56_000_000, "margin + 100 slots of premium");
    }

    #[test]
    fn long_mint_needs_margin_for_the_new_long_on_top_of_existing() {
        let m = market();
        // R1: 1 µUSDC cannot back a 1-unit long (needs 1_000_001).
        assert!(check_long_mint_allowed(&user(0, 1), &[], 0, &m, 1).is_err());
        assert!(check_long_mint_allowed(&user(0, 1_000_001), &[], 0, &m, 1).is_ok());

        // With an existing long, both margins must be covered.
        let existing = long(50_000_000, 0);
        let u = user(0, 101_000_000); // 51e6 + 50e6 buffer-less would fail; needs 51e6 + 51e6
        assert!(check_long_mint_allowed(&u, &[existing.clone()], 0, &m, 50_000_000).is_err());
        let u = user(0, 102_000_000);
        assert!(check_long_mint_allowed(&u, &[existing], 0, &m, 50_000_000).is_ok());
    }

    /// The projection helper never writes: prove it by value.
    #[test]
    fn payable_if_settled_now_does_not_mutate() {
        let m = market();
        let l = long(1_000_000, 0);
        let before = (l.entry_index, l.accrued_scaled);
        let p = payable_if_settled_now(&l, 100 * 1_000_000, &m).unwrap();
        assert_eq!(p, 100_000, "V1 figure, ceil == floor when exact");
        assert_eq!((l.entry_index, l.accrued_scaled), before);
    }

    /// Ceil vs floor: the settle path floors and carries; the gate rounds up.
    #[test]
    fn projection_rounds_up_where_settle_would_floor() {
        let m = market();
        let l = long(1_500, 0);
        // 1 slot: 1e6 × 1500 × 1e3 / 1e12 = 1.5 → settle pays 1 (carry 0.5); gate counts 2.
        assert_eq!(payable_if_settled_now(&l, 1_000_000, &m).unwrap(), 2);
    }
}
