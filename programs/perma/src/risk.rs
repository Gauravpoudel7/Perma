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
//! - **Liquidation reads no price either** (ADR-0005 §1): an account is
//!   liquidatable when free USDC falls below [`maintenance_free_usdc`], the
//!   same requirement with the forward margin discounted to 75 %.
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
    required_margin_with(
        market.long_margin_horizon_slots,
        market.premium_rate,
        market.premium_multiplier,
        market.long_margin_buffer_usdc,
        liquidity,
    )
}

/// The margin formula over explicit parameters, so `set_market_risk_params`
/// can re-validate a *candidate* horizon/buffer through the exact checked path
/// the runtime uses (ADR-0003 forward requirement). `required_margin` is a
/// delegate to this; there is one implementation.
pub(crate) fn required_margin_with(
    horizon_slots: u64,
    premium_rate: u64,
    premium_multiplier: u64,
    buffer_usdc: u64,
    liquidity: u128,
) -> Result<u64> {
    let scaled = (horizon_slots as u128)
        .checked_mul(premium_rate as u128)
        .ok_or(PermaError::MathOverflow)?
        .checked_mul(liquidity)
        .ok_or(PermaError::MathOverflow)?
        .checked_mul(premium_multiplier as u128)
        .ok_or(PermaError::MathOverflow)?;
    let q = scaled / PREMIUM_SCALE;
    let r = scaled % PREMIUM_SCALE;
    let per_horizon = q + u128::from(r != 0);
    let total = per_horizon
        .checked_add(buffer_usdc as u128)
        .ok_or(PermaError::MathOverflow)?;
    u64::try_from(total).map_err(|_| PermaError::MathOverflow.into())
}

/// Largest single-position liquidity the risk parameters must stay solvent
/// for. `set_market_risk_params` rejects any horizon/buffer whose margin at
/// this L - summed over `MAX_OPEN_LONGS` positions, as `required_free_usdc`
/// does - would not fit `u64`, because an overflow at *withdraw* time locks
/// the user's funds (ADR-0003).
///
/// `2^52 ≈ 4.5e15`: ~4.5e7× the largest demo position (`1e8`), ≈ $800k in the
/// narrowest 8-tick band of a SOL/USDC pool at ~$200. The trade-off it fixes:
/// `8 × (horizon × rate × mult / 1e12) × 2^52 ≤ u64::MAX` ⇒ factor ≤ 512 ⇒
/// at the demo rate/multiplier the admissible horizon is ≤ ~512_000 slots
/// (~2.4 days). Raising this bound tightens that ceiling; see
/// `IMPL-10-FEASIBILITY.md` Q4 before changing it.
pub const MARGIN_LIQUIDITY_BOUND: u128 = 1 << 52;

/// Gate a candidate `(horizon, buffer)` for `set_market_risk_params`.
///
/// Rejects a zero horizon (margin would collapse to the buffer for any L) or
/// zero buffer (the ADR's flat floor), then proves the margin at
/// [`MARGIN_LIQUIDITY_BOUND`] - and its `MAX_OPEN_LONGS`-fold sum - fits
/// `u64` under the market's *current* rate and multiplier. The formula is
/// monotone in L, so passing at the bound covers every smaller position.
pub(crate) fn validate_risk_params(
    horizon_slots: u64,
    buffer_usdc: u64,
    premium_rate: u64,
    premium_multiplier: u64,
) -> Result<()> {
    require!(horizon_slots > 0, PermaError::InvalidRiskParams);
    require!(buffer_usdc > 0, PermaError::InvalidRiskParams);
    let margin = required_margin_with(
        horizon_slots,
        premium_rate,
        premium_multiplier,
        buffer_usdc,
        MARGIN_LIQUIDITY_BOUND,
    )
    .map_err(|_| error!(PermaError::InvalidRiskParams))?;
    let sum = u128::from(margin)
        .checked_mul(u128::from(MAX_OPEN_LONGS))
        .ok_or(PermaError::InvalidRiskParams)?;
    require!(sum <= u128::from(u64::MAX), PermaError::InvalidRiskParams);
    Ok(())
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
    let (owed, margin) = requirement_parts(user, longs, projected, market)?;
    let total = owed.checked_add(margin).ok_or(PermaError::MathOverflow)?;
    u64::try_from(total).map_err(|_| PermaError::MathOverflow.into())
}

/// `(owed now, Σ margin)` - the two halves of [`required_free_usdc`], kept
/// apart so liquidation can discount the forward margin only.
fn requirement_parts(
    user: &UserCollateral,
    longs: &[PermaPosition],
    projected: u128,
    market: &Market,
) -> Result<(u128, u128)> {
    let mut owed = user.premium_owed_usdc as u128;
    let mut margin = 0u128;
    for pos in longs {
        owed = owed
            .checked_add(payable_if_settled_now(pos, projected, market)? as u128)
            .ok_or(PermaError::MathOverflow)?;
        margin = margin
            .checked_add(required_margin(market, pos.liquidity)? as u128)
            .ok_or(PermaError::MathOverflow)?;
    }
    Ok((owed, margin))
}

/// ADR-0005 §3 numeric policy. Demo values; change only by amending the ADR.
pub const MAINT_MARGIN_BPS: u128 = 7_500;
pub const FX_FEE_BASE_SLOTS: u64 = 100;
pub const FX_FEE_MAX_HALVINGS: i64 = 10;
const BPS: u128 = 10_000;

/// `⌈x × MAINT_MARGIN_BPS / 10_000⌉` - maintenance share of a margin.
fn maint_share(x: u128) -> Result<u128> {
    let scaled = x.checked_mul(MAINT_MARGIN_BPS).ok_or(PermaError::MathOverflow)?;
    Ok(scaled.div_ceil(BPS))
}

/// Free USDC below which an account is liquidatable (ADR-0005 §1): owed
/// premium in full plus 75 % of the forward margin. Initial requirement
/// ([`required_free_usdc`]) is 4/3 of this margin, as in Panoptic.
pub(crate) fn maintenance_free_usdc(
    user: &UserCollateral,
    longs: &[PermaPosition],
    projected: u128,
    market: &Market,
) -> Result<u64> {
    let (owed, margin) = requirement_parts(user, longs, projected, market)?;
    let total = owed
        .checked_add(maint_share(margin)?)
        .ok_or(PermaError::MathOverflow)?;
    u64::try_from(total).map_err(|_| PermaError::MathOverflow.into())
}

/// `min(remaining / 2, deficit, maintenance margin the close releases)`.
///
/// The last term is what keeps a split liquidation from out-earning a single
/// one: no call pays more than the maintenance it frees, so the deficit never
/// grows between calls.
pub(crate) fn liquidation_bonus(remaining: u64, deficit: u64, target_margin: u64) -> Result<u64> {
    let released = u64::try_from(maint_share(target_margin as u128)?)
        .map_err(|_| error!(PermaError::MathOverflow))?;
    Ok((remaining / 2).min(deficit).min(released))
}

/// Force-exercise fee (ADR-0005 §2): the premium this long would pay over
/// `FX_FEE_BASE_SLOTS`, halved per half-width the tick sits from the range
/// midpoint, at most `FX_FEE_MAX_HALVINGS` times, floor 1 µUSDC.
pub(crate) fn force_exercise_fee(
    market: &Market,
    liquidity: u128,
    tick_lower: i32,
    tick_upper: i32,
    tick: i32,
) -> Result<u64> {
    let base = required_margin_with(
        FX_FEE_BASE_SLOTS,
        market.premium_rate,
        market.premium_multiplier,
        0,
        liquidity,
    )?;
    let hw = ((i64::from(tick_upper) - i64::from(tick_lower)) / 2).max(1);
    let mid = i64::from(tick_lower) + hw;
    let n = ((i64::from(tick) - mid).abs() / hw).max(1);
    let halvings = (n - 1).min(FX_FEE_MAX_HALVINGS) as u32;
    Ok((base >> halvings).max(1))
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

    // --- validate_risk_params (component 10, ADR-0003 forward requirement) --

    const RATE: u64 = premium_defaults::PREMIUM_RATE;
    const MULT: u64 = premium_defaults::PREMIUM_MULTIPLIER;
    const HORIZON: u64 = risk_defaults::LONG_MARGIN_HORIZON_SLOTS;
    const BUFFER: u64 = risk_defaults::LONG_MARGIN_BUFFER_USDC;

    /// The shipped defaults pass, with the exact headroom claimed in
    /// `IMPL-10-FEASIBILITY.md` Q4.
    #[test]
    fn demo_defaults_pass_the_bound_with_headroom() {
        assert!(validate_risk_params(HORIZON, BUFFER, RATE, MULT).is_ok());
        let at_bound =
            required_margin_with(HORIZON, RATE, MULT, BUFFER, MARGIN_LIQUIDITY_BOUND).unwrap();
        assert_eq!(at_bound, 4_503_599_628_370_496, "factor 1: L + buffer");
        assert_eq!(
            u128::from(at_bound) * u128::from(MAX_OPEN_LONGS),
            36_028_797_026_963_968
        );
    }

    /// A single margin that still fits u64 but whose 8-fold sum does not is
    /// exactly the withdraw-time brick the ADR names; the sum guard catches it.
    #[test]
    fn sum_over_max_open_longs_is_guarded() {
        let horizon = 1_000_000; // factor 1000: margin(BOUND) ≈ 4.5e18 fits, ×8 does not
        assert!(required_margin_with(horizon, RATE, MULT, BUFFER, MARGIN_LIQUIDITY_BOUND).is_ok());
        assert!(validate_risk_params(horizon, BUFFER, RATE, MULT).is_err());
    }

    #[test]
    fn product_chain_overflow_is_rejected() {
        assert!(validate_risk_params(u64::MAX, BUFFER, RATE, MULT).is_err());
    }

    #[test]
    fn zero_horizon_or_buffer_is_rejected() {
        assert!(validate_risk_params(0, BUFFER, RATE, MULT).is_err());
        assert!(validate_risk_params(HORIZON, 0, RATE, MULT).is_err());
    }

    /// Every rejection surfaces as `InvalidRiskParams`, never a bare
    /// `MathOverflow`, so the admin and the tests see one name.
    #[test]
    fn rejections_are_invalid_risk_params() {
        for (h, b) in [(0, BUFFER), (HORIZON, 0), (1_000_000, BUFFER), (u64::MAX, BUFFER)] {
            let err = validate_risk_params(h, b, RATE, MULT).unwrap_err();
            assert!(
                err.to_string().contains("InvalidRiskParams"),
                "({h}, {b}) -> {err}"
            );
        }
    }

    /// The delegate refactor changed nothing: `required_margin` == `_with`.
    #[test]
    fn required_margin_delegates_to_required_margin_with() {
        let m = market();
        for l in [0u128, 1, 1_000, 50_000_000, MARGIN_LIQUIDITY_BOUND] {
            assert_eq!(
                required_margin(&m, l).unwrap(),
                required_margin_with(HORIZON, RATE, MULT, BUFFER, l).unwrap()
            );
        }
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

    // --- P4, FIXTURES-AND-VECTORS.md §8 (ADR-0005) ---

    const L: u128 = 50_000_000;
    const SLOTS_100: u128 = 100 * 1_000_000; // projected index after 100 slots

    /// L1 / L2: 75 % of `L + 1 USDC` is 38.25 USDC; the boundary is solvent.
    #[test]
    fn p4_maintenance_and_boundary() {
        let m = market();
        let longs = [long(L, 0)];
        assert_eq!(maintenance_free_usdc(&user(0, 0), &longs, 0, &m).unwrap(), 38_250_000);
        assert_eq!(
            maintenance_free_usdc(&user(0, 0), &longs, SLOTS_100, &m).unwrap(),
            43_250_000
        );
        // Initial requirement is unchanged by P4.
        assert_eq!(required_free_usdc(&user(0, 0), &longs, SLOTS_100, &m).unwrap(), 56_000_000);
    }

    /// L2, L3: the bonus is the three-way minimum.
    #[test]
    fn p4_liquidation_bonus_vectors() {
        let margin = 51_000_000;
        // L2: free 40, owes 5 → R = 35, D = 3.25.
        assert_eq!(liquidation_bonus(35_000_000, 3_250_000, margin).unwrap(), 3_250_000);
        // L3: free 6, owes 5 → R = 1, D = 37.25 → R/2.
        assert_eq!(liquidation_bonus(1_000_000, 37_250_000, margin).unwrap(), 500_000);
        // Capped by the released maintenance margin.
        assert_eq!(liquidation_bonus(u64::MAX, u64::MAX, margin).unwrap(), 38_250_000);
    }

    /// Splitting never beats one call: each bonus ≤ the maintenance it frees,
    /// so the account's deficit is non-increasing across calls.
    #[test]
    fn p4_split_liquidation_never_grows_deficit() {
        let m = market();
        let a = long(L, 0);
        let b = long(L, 0);
        let mut free = 70_000_000u64; // maint for both = 2 × 38.25 = 76.5
        let before = maintenance_free_usdc(&user(0, free), &[a.clone(), b.clone()], 0, &m).unwrap() - free;
        let bonus = liquidation_bonus(free, before, required_margin(&m, L).unwrap()).unwrap();
        free -= bonus;
        let after = maintenance_free_usdc(&user(0, free), &[b], 0, &m).unwrap().saturating_sub(free);
        assert!(after <= before, "deficit {after} grew from {before}");
    }

    /// FX_NEAR / FX_FAR / floors on the demo range [-40176, -38168).
    #[test]
    fn p4_force_exercise_fee_vectors() {
        let m = market();
        let fee = |liq, tick| force_exercise_fee(&m, liq, -40176, -38168, tick).unwrap();
        assert_eq!(fee(L, -37858), 5_000_000, "FX_NEAR_RANGE_FEE");
        assert_eq!(fee(L, -34152), 312_500, "FX_FAR_RANGE_FEE");
        assert_eq!(fee(L, -20000), 4_882, "at most 10 halvings");
        assert_eq!(fee(1, -37858), 1, "floor 1 µUSDC");
        assert_eq!(fee(L, -44192), fee(L, -34152), "symmetric about the midpoint");
    }
}
