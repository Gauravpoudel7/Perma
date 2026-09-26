//! Premium engine - **minimal component 07 scaffold**.
//!
//! What ships here: the index clock, the per-range entitlement accumulator, and
//! long accrual. That is the minimum component 06 needs, because
//! `06-long-mint-inventory.md`'s own sequence opens with `update_index()` then
//! `poke_range()` before any weight change, and the inventory figures it gates
//! on live on `RangePremiumState`.
//!
//! **What does NOT ship here: any movement of money.** No `settle_premium`, no
//! `range_vault`, no `PendingPremium`. Entitlement is computed and recorded;
//! paying it is component 08.
//!
//! # The ordering rule
//!
//! `poke_range` MUST run before any change to `total_short_liquidity` or
//! `total_long_liquidity`. The elapsed period has to be attributed at the
//! weights that were in force *during* it. Poking afterwards silently
//! misallocates the whole period - see [`tests::v4_poking_after_the_weight_change_is_wrong`],
//! where a short that joined at slot 100 collects `49_999` for a period it did
//! not exist in instead of its correct `24_999`.

use anchor_lang::prelude::*;

use crate::errors::PermaError;
use crate::state::{GlobalPremiumIndex, Market, PermaPosition, RangePremiumState};
use crate::tick_math::notional_q64;

/// Fixed-point denominator for premium accrual. Matches
/// `07-premium-engine.md` §A and `state::premium_defaults`.
pub const PREMIUM_SCALE: u128 = 1_000_000_000_000;

/// `d_index × mult × L × v / 2^64` in scaled units: what `L` of this range
/// owes over `d_index`, priced on its notional `L·v` (ADR-0006), not on `L`.
///
/// `ceil` is for a long's own charge and `false` for a range's inflow to its
/// shorts, so longs always pay at least what shorts are credited. The ceil
/// costs a long at most 1 scaled unit (1e-12 µUSDC) per accrual, which is why
/// crank frequency stays neutral for any realistic number of cranks.
pub(crate) fn scaled_charge(
    d_index: u128,
    premium_multiplier: u64,
    liquidity: u128,
    tick_lower: i32,
    tick_upper: i32,
    ceil: bool,
) -> Result<u128> {
    if d_index == 0 || liquidity == 0 {
        return Ok(0);
    }
    let per_notional = d_index
        .checked_mul(premium_multiplier as u128)
        .ok_or(PermaError::MathOverflow)?;
    notional_q64(liquidity, tick_lower, tick_upper)?
        .checked_mul_u128(per_notional)
        .ok_or(PermaError::MathOverflow)?
        .shr(64, ceil)
        .to_u128()
}

/// Advance the global clock to `now_slot`.
///
/// Pure function of elapsed slots, which is why the poke reward is zero: a late
/// call catches up exactly. Monotonic - a stale `now_slot` is a no-op rather
/// than a rewind.
pub(crate) fn update_index(
    index: &mut GlobalPremiumIndex,
    premium_rate: u64,
    now_slot: u64,
) -> Result<()> {
    let elapsed = now_slot.saturating_sub(index.last_update_slot);
    if elapsed > 0 {
        let delta = (elapsed as u128)
            .checked_mul(premium_rate as u128)
            .ok_or(PermaError::MathOverflow)?;
        index.current_index = index
            .current_index
            .checked_add(delta)
            .ok_or(PermaError::MathOverflow)?;
        index.last_update_slot = now_slot;
    }
    Ok(())
}

/// Advance a range's entitlement accumulator to the current index.
///
/// **Call before touching `total_short_liquidity` or `total_long_liquidity`.**
///
/// `inflow` is what every long in the range owes for the elapsed period,
/// priced on the range's notional (see [`scaled_charge`]);
/// dividing by `total_short_liquidity` spreads it pro-rata across the shorts
/// that actually provided the liquidity. Both floors are deliberate - the
/// residue becomes `dust` rather than being credited to anyone (ADR-0002).
pub(crate) fn poke_range(
    index: &GlobalPremiumIndex,
    market: &Market,
    range: &mut RangePremiumState,
) -> Result<()> {
    let d_index = index.current_index.saturating_sub(range.last_index);

    if d_index > 0 && range.total_long_liquidity > 0 && range.total_short_liquidity > 0 {
        let inflow = scaled_charge(
            d_index,
            market.premium_multiplier,
            range.total_long_liquidity,
            range.tick_lower,
            range.tick_upper,
            false,
        )? / PREMIUM_SCALE;

        // Q64.64 per unit of short liquidity.
        let per_unit = inflow
            .checked_shl(64)
            .ok_or(PermaError::MathOverflow)?
            / range.total_short_liquidity;

        range.acc_premium_per_short_q64 = range
            .acc_premium_per_short_q64
            .checked_add(per_unit)
            .ok_or(PermaError::MathOverflow)?;
    }

    range.last_index = index.current_index;
    Ok(())
}

/// Accrue a long's premium obligation up to the current index.
///
/// Accumulates in **scaled** units and rolls the checkpoint forward. The only
/// rounding here is [`scaled_charge`]'s ceil (≤ 1e-12 µUSDC); whole µUSDC are
/// rounded once, at [`payable_from`].
pub(crate) fn accrue_long(
    index: &GlobalPremiumIndex,
    market: &Market,
    position: &mut PermaPosition,
) -> Result<()> {
    let d_index = index.current_index.saturating_sub(position.entry_index);
    if d_index > 0 {
        let add = scaled_charge(
            d_index,
            market.premium_multiplier,
            position.liquidity,
            position.tick_lower,
            position.tick_upper,
            true,
        )?;
        position.accrued_scaled = position
            .accrued_scaled
            .checked_add(add)
            .ok_or(PermaError::MathOverflow)?;
    }
    position.entry_index = index.current_index;
    Ok(())
}

/// Convert accrued scaled units into whole µUSDC, **carrying the remainder**.
///
/// Floor-with-carry is a security property, not a style choice: it makes settle
/// frequency irrelevant to the total owed. Rounding up per settle would let
/// anyone inflate a long's cost by cranking often (ADR-0002); rounding down
/// without the carry would silently underpay shorts.
pub(crate) fn payable_from(position: &mut PermaPosition) -> u64 {
    let payable = (position.accrued_scaled / PREMIUM_SCALE) as u64;
    position.accrued_scaled -= (payable as u128) * PREMIUM_SCALE;
    payable
}

/// A short's entitlement since its last checkpoint, in µUSDC.
///
/// Computed in component 06; **paid** in component 08.
pub(crate) fn claimable_for(position: &PermaPosition, range: &RangePremiumState) -> u64 {
    let delta = range
        .acc_premium_per_short_q64
        .saturating_sub(position.entry_acc_q64);
    ((delta.saturating_mul(position.liquidity)) >> 64) as u64
}

// --- Read-only projections (component 09) --------------------------------

/// Where the index *would* be at `now_slot`, without writing it.
///
/// `withdraw_collateral` does not run the poke prefix, so the stored index can
/// lag by however long nobody has cranked. Because [`update_index`] is a pure
/// function of elapsed slots, the projection is exact: this returns precisely
/// the value `update_index(index, rate, now_slot)` would leave behind. Used by
/// the solvency gate so a long cannot under-count by withdrawing before anyone
/// settles (ADR-0003).
pub(crate) fn projected_index(
    index: &GlobalPremiumIndex,
    premium_rate: u64,
    now_slot: u64,
) -> Result<u128> {
    let elapsed = now_slot.saturating_sub(index.last_update_slot);
    let delta = (elapsed as u128)
        .checked_mul(premium_rate as u128)
        .ok_or(PermaError::MathOverflow)?;
    Ok(index
        .current_index
        .checked_add(delta)
        .ok_or(PermaError::MathOverflow)?)
}

/// What `settle_premium` would charge this long at `projected` - **rounded up**
/// and **never written**.
///
/// Mirrors [`accrue_long`] + [`payable_from`] on the numbers alone: the
/// position, its checkpoint and the index are untouched. Rounding up here does
/// not conflict with `payable_from`'s floor-with-carry - nothing is settled, so
/// crank frequency stays neutral - and `ceil >= floor` guarantees a withdraw
/// that passes leaves enough for the next real settle.
pub(crate) fn payable_if_settled_now(
    position: &PermaPosition,
    projected: u128,
    market: &Market,
) -> Result<u64> {
    let d_index = projected.saturating_sub(position.entry_index);
    let add = scaled_charge(
        d_index,
        market.premium_multiplier,
        position.liquidity,
        position.tick_lower,
        position.tick_upper,
        true,
    )?;
    let scaled = position
        .accrued_scaled
        .checked_add(add)
        .ok_or(PermaError::MathOverflow)?;
    let q = scaled / PREMIUM_SCALE;
    let r = scaled % PREMIUM_SCALE;
    let payable = q + u128::from(r != 0);
    u64::try_from(payable).map_err(|_| PermaError::MathOverflow.into())
}

// --- Cash-facing helpers (component 08) ----------------------------------

/// What a short can be paid right now, and what remains owed.
///
/// Entitlement accrues on elapsed time (`claimable_for`); cash arrives only
/// when a long settles. `paid` is capped by what the pool actually holds, and
/// the shortfall is carried on the position as `premium_receivable` so a short
/// that exits early still gets paid when the money turns up (ADR-0002).
///
/// Pure: the caller performs the transfer and updates `premium_pool`.
pub(crate) fn claim_short_amount(
    position: &PermaPosition,
    range: &RangePremiumState,
) -> Result<(u64, u64)> {
    let earned = claimable_for(position, range);
    let owed = earned
        .checked_add(position.premium_receivable)
        .ok_or(PermaError::MathOverflow)?;
    let paid = owed.min(range.premium_pool);
    Ok((paid, owed - paid))
}

/// Apply a short claim to the position and the range.
///
/// Splitting this from [`claim_short_amount`] keeps the arithmetic testable
/// while the instruction layer owns the token transfer.
pub(crate) fn apply_short_claim(
    position: &mut PermaPosition,
    range: &mut RangePremiumState,
    paid: u64,
    still_owed: u64,
) -> Result<()> {
    range.premium_pool = range
        .premium_pool
        .checked_sub(paid)
        .ok_or(PermaError::PremiumPoolUnderfunded)?;

    // Roll the checkpoint forward: everything up to now is either paid or
    // carried, so it must not be claimable twice.
    position.entry_acc_q64 = range.acc_premium_per_short_q64;

    // `receivable` is the range-wide mirror of every position's carry.
    range.receivable = range
        .receivable
        .checked_sub(position.premium_receivable.min(range.receivable))
        .ok_or(PermaError::MathOverflow)?;
    position.premium_receivable = still_owed;
    range.receivable = range
        .receivable
        .checked_add(still_owed)
        .ok_or(PermaError::MathOverflow)?;
    Ok(())
}

/// Record a long's payment into the range bucket.
///
/// The caller must have already moved `paid` µUSDC into the range vault - this
/// only updates the books, and the two live in one instruction so they cannot
/// drift apart.
pub(crate) fn apply_long_payment(range: &mut RangePremiumState, paid: u64) -> Result<()> {
    range.premium_pool = range
        .premium_pool
        .checked_add(paid)
        .ok_or(PermaError::MathOverflow)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{leg_type, position_status};

    // The Fair-era values, now the upper bounds: they make 100-slot vectors
    // produce readable µUSDC on the demo range.
    const RATE: u64 = 1_000_000;
    const MULT: u64 = 1_000;
    const LO: i32 = -40176;
    const HI: i32 = -38168;

    /// v of the demo range, from Orca's table.
    fn v() -> u128 {
        crate::tick_math::range_value_q64(LO, HI).unwrap()
    }

    /// Independent reference in plain u128 (no U256): the scaled charge for
    /// `slots` slots at RATE/MULT on `l`, rounded as asked.
    fn reference_scaled(slots: u128, l: u128, ceil: bool) -> u128 {
        let x = slots * RATE as u128 * MULT as u128 * l * v();
        if ceil { (x + (1u128 << 64) - 1) >> 64 } else { x >> 64 }
    }

    /// What a range credits its shorts per `total_short` for `slots` slots.
    fn reference_claim(slots: u128, long_l: u128, short_l: u128, holder_l: u128) -> u64 {
        let inflow = reference_scaled(slots, long_l, false) / PREMIUM_SCALE;
        (((inflow << 64) / short_l * holder_l) >> 64) as u64
    }

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
            premium_rate: RATE,
            premium_multiplier: MULT,
            long_margin_horizon_slots: 1_000,
            long_margin_buffer_usdc: 1_000_000,
        }
    }

    fn index() -> GlobalPremiumIndex {
        GlobalPremiumIndex { current_index: 0, last_update_slot: 0, bump: 255 }
    }

    fn range() -> RangePremiumState {
        RangePremiumState {
            market: Pubkey::new_unique(),
            tick_lower: LO,
            tick_upper: HI,
            total_short_liquidity: 0,
            total_long_liquidity: 0,
            acc_premium_per_short_q64: 0,
            last_index: 0,
            premium_pool: 0,
            receivable: 0,
            dust: 0,
            bump: 255,
        }
    }

    fn position(liquidity: u128, leg: u8) -> PermaPosition {
        PermaPosition {
            market: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            orca_position: Pubkey::default(),
            position_mint: Pubkey::default(),
            tick_lower: LO,
            tick_upper: HI,
            liquidity,
            in_orca_a: 0,
            in_orca_b: 0,
            locked_a: 0,
            locked_b: 0,
            leg_type: leg,
            status: position_status::OPEN,
            entry_index: 0,
            accrued_scaled: 0,
            entry_acc_q64: 0,
            premium_receivable: 0,
            nonce: 1,
            bump: 255,
        }
    }

    // --- index ------------------------------------------------------------

    #[test]
    fn index_advances_by_elapsed_slots_and_never_rewinds() {
        let mut i = index();
        update_index(&mut i, RATE, 100).unwrap();
        assert_eq!(i.current_index, 100 * RATE as u128);

        // A stale slot is a no-op, not a rewind.
        update_index(&mut i, RATE, 50).unwrap();
        assert_eq!(i.current_index, 100 * RATE as u128);
        assert_eq!(i.last_update_slot, 100);
    }

    #[test]
    fn a_late_poke_catches_up_exactly() {
        // One 100-slot jump == ten 10-slot jumps. This is why the poke reward
        // can be zero: nothing is lost by not calling it.
        let mut lazy = index();
        update_index(&mut lazy, RATE, 100).unwrap();

        let mut eager = index();
        for s in 1..=10 {
            update_index(&mut eager, RATE, s * 10).unwrap();
        }
        assert_eq!(lazy.current_index, eager.current_index);
    }

    /// Vector V1: one long, L = 1e8 on the demo range, 100 slots. Notional
    /// is L·v ≈ 2.84 USDC, and 100 slots at 1e-3 per slot cost ≈ 0.284 USDC.
    #[test]
    fn v1_single_long_accrual() {
        let (m, mut i) = (market(), index());
        let mut p = position(100_000_000, leg_type::LONG);

        update_index(&mut i, RATE, 100).unwrap();
        accrue_long(&i, &m, &mut p).unwrap();

        let expected = reference_scaled(100, 100_000_000, true);
        assert_eq!(p.accrued_scaled, expected);
        let paid = payable_from(&mut p);
        assert_eq!(paid as u128, expected / PREMIUM_SCALE);
        assert_eq!(p.accrued_scaled, expected % PREMIUM_SCALE, "remainder is carried");
        // Closed form: 100 slots × 1e-3 × L × (√Pu − √Pl).
        let closed = 100.0 * 1e-3 * 1e8 * (1.0001f64.powf(HI as f64 / 2.0) - 1.0001f64.powf(LO as f64 / 2.0));
        assert!((paid as f64 - closed).abs() <= 1.0, "{paid} vs {closed} (floor to whole µUSDC)");
    }

    /// Premium is priced on notional: equal notionals on a narrow and a wide
    /// range owe the same, whatever L each needed.
    #[test]
    fn equal_notional_owes_equal_premium_on_any_width() {
        let m = market();
        let mut i = index();
        update_index(&mut i, RATE, 100).unwrap();
        let owe = |lo: i32, hi: i32, l: u128| {
            let mut p = position(l, leg_type::LONG);
            (p.tick_lower, p.tick_upper) = (lo, hi);
            accrue_long(&i, &m, &mut p).unwrap();
            payable_from(&mut p)
        };
        // 32 ticks vs 2048 ticks around the same point, each ≈ 100 USDC notional.
        let l_for = |lo: i32, hi: i32| {
            (100_000_000u128 << 64) / crate::tick_math::range_value_q64(lo, hi).unwrap()
        };
        let narrow = owe(-39_152, -39_120, l_for(-39_152, -39_120));
        let wide = owe(-40_160, -38_112, l_for(-40_160, -38_112));
        assert!(narrow > 0 && wide > 0);
        assert!((narrow as i64 - wide as i64).abs() <= 1, "{narrow} vs {wide}");
    }

    /// Vector V6: floor-with-carry makes settle frequency irrelevant.
    #[test]
    fn v6_settle_frequency_neutrality() {
        let m = market();

        // 100 single-slot settles.
        let (mut i, mut p) = (index(), position(1_500_000, leg_type::LONG));
        let mut total = 0u64;
        for s in 1..=100 {
            update_index(&mut i, RATE, s).unwrap();
            accrue_long(&i, &m, &mut p).unwrap();
            total += payable_from(&mut p);
        }

        // One 100-slot settle.
        let (mut i2, mut p2) = (index(), position(1_500_000, leg_type::LONG));
        update_index(&mut i2, RATE, 100).unwrap();
        accrue_long(&i2, &m, &mut p2).unwrap();
        let one_shot = payable_from(&mut p2);

        assert!(total > 0);
        // Each crank's ceil adds at most 1e-12 µUSDC: 100 cranks cannot move a
        // whole µUSDC unless the one-shot sat right on a boundary.
        assert!(total >= one_shot, "cranking never lets a long pay less");
        assert!(total - one_shot <= 1, "settle frequency must not change the total ({total} vs {one_shot})");
        assert!(p.accrued_scaled < PREMIUM_SCALE, "carry stays sub-unit");
    }

    // --- V4: the ordering rule -------------------------------------------

    /// Vector V4, done correctly: poke BEFORE the weight change.
    ///
    /// Two 100-slot periods. Long holds 1e6 throughout. Short A (3e6) is
    /// present for both; short B (1e6) joins at slot 100.
    #[test]
    fn v4_poking_before_the_weight_change_is_correct() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 3_000_000;
        r.total_long_liquidity = 1_000_000_000;

        let entry_a = r.acc_premium_per_short_q64; // A checkpoints at 0

        // Period 1 at ts = 3e6.
        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        // B joins AFTER the poke - so it checkpoints at the post-period-1 value
        // and earns nothing for period 1.
        let entry_b = r.acc_premium_per_short_q64;
        r.total_short_liquidity = 4_000_000;

        // Period 2 at ts = 4e6.
        update_index(&mut i, RATE, 200).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        let mut a = position(3_000_000, leg_type::SHORT);
        a.entry_acc_q64 = entry_a;
        let mut b = position(1_000_000, leg_type::SHORT);
        b.entry_acc_q64 = entry_b;

        let (claim_a, claim_b) = (claimable_for(&a, &r), claimable_for(&b, &r));
        let per_period = (reference_scaled(100, 1_000_000_000, false) / PREMIUM_SCALE) as u64;
        // A takes all of period 1 and 3/4 of period 2; B takes 1/4 of period 2.
        assert!(claim_a.abs_diff(per_period + per_period * 3 / 4) <= 2, "{claim_a}");
        assert!(claim_b.abs_diff(per_period / 4) <= 1, "{claim_b}");

        // Zero-sum: claims plus dust equal what the longs owed.
        let dust = 2 * per_period - claim_a - claim_b;
        assert!(dust <= 3, "the residue is dust: {dust}");
    }

    /// The same scenario with the ordering violated - the bug invariant 5 exists
    /// to prevent.
    ///
    /// B is added to the denominator *before* period 1 is poked, so period 1 is
    /// attributed at the wrong weights and B collects for a period it did not
    /// exist in.
    #[test]
    fn v4_poking_after_the_weight_change_is_wrong() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_long_liquidity = 1_000_000_000;
        r.total_short_liquidity = 4_000_000; // B added FIRST - the mistake

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();
        update_index(&mut i, RATE, 200).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        let mut a = position(3_000_000, leg_type::SHORT);
        let mut b = position(1_000_000, leg_type::SHORT);
        a.entry_acc_q64 = 0;
        b.entry_acc_q64 = 0; // B never got a mid-stream checkpoint

        let per_period = (reference_scaled(100, 1_000_000_000, false) / PREMIUM_SCALE) as u64;
        // Both periods at 3:1 - A gets 3/4 of both, B 1/4 of both.
        assert!(claimable_for(&a, &r).abs_diff(per_period * 3 / 2) <= 2, "A is short-changed");
        assert!(
            claimable_for(&b, &r).abs_diff(per_period / 2) <= 1,
            "B collects ~2x its due, for a period it did not exist in"
        );
    }

    // --- range mechanics --------------------------------------------------

    #[test]
    fn poke_is_inert_without_both_sides() {
        let (m, mut i) = (market(), index());
        update_index(&mut i, RATE, 100).unwrap();

        // Shorts but no longs: nobody owes anything.
        let mut r = range();
        r.total_short_liquidity = 1_000_000;
        poke_range(&i, &m, &mut r).unwrap();
        assert_eq!(r.acc_premium_per_short_q64, 0);
        assert_eq!(r.last_index, i.current_index, "clock still advances");

        // Longs but no shorts cannot happen (the gate forbids it), but the
        // division must not panic if it somehow did.
        let mut r2 = range();
        r2.total_long_liquidity = 1_000_000;
        poke_range(&i, &m, &mut r2).unwrap();
        assert_eq!(r2.acc_premium_per_short_q64, 0);
    }

    #[test]
    fn available_is_derived_and_never_the_denominator() {
        let mut r = range();
        r.total_short_liquidity = 3_000_000;
        r.total_long_liquidity = 1_000_000;

        assert_eq!(r.available_short_liquidity(), 2_000_000);
        // A long consumes availability but must NOT shrink the denominator -
        // doing so would over-pay the same shorts.
        assert_eq!(r.total_short_liquidity, 3_000_000);
    }

    #[test]
    fn available_saturates_rather_than_underflowing() {
        let mut r = range();
        r.total_short_liquidity = 100;
        r.total_long_liquidity = 500; // should be unreachable; must not wrap
        assert_eq!(r.available_short_liquidity(), 0);
    }

    // --- component 08: cash helpers -----------------------------------

    /// A claim can never exceed what the pool actually holds.
    #[test]
    fn claim_is_capped_by_the_pool_and_carries_the_rest() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 1_000_000;
        r.total_long_liquidity = 1_000_000_000;

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        let s = position(1_000_000, leg_type::SHORT);
        let earned = claimable_for(&s, &r);
        assert_eq!(earned, reference_claim(100, 1_000_000_000, 1_000_000, 1_000_000));
        assert!(earned > 0);

        // Pool is empty: nothing payable, everything carried. This is V5.
        let (paid, owed) = claim_short_amount(&s, &r).unwrap();
        assert_eq!((paid, owed), (0, earned));

        // Long funds the pool; now the whole claim clears.
        r.premium_pool = earned + 1;
        let (paid2, owed2) = claim_short_amount(&s, &r).unwrap();
        assert_eq!((paid2, owed2), (earned, 0));
    }

    /// V5 end-to-end on the books: carry survives, then clears, and the
    /// leftover in the pool is dust.
    #[test]
    fn v5_short_exits_early_and_is_made_whole_when_cash_arrives() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 1_000_000;
        r.total_long_liquidity = 1_000_000_000;

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        let mut s = position(1_000_000, leg_type::SHORT);
        let earned = claimable_for(&s, &r);
        let (paid, owed) = claim_short_amount(&s, &r).unwrap();
        apply_short_claim(&mut s, &mut r, paid, owed).unwrap();
        assert_eq!(s.premium_receivable, earned, "carried, not forfeited");
        assert_eq!(r.receivable, earned);

        // A long later pays in what it owed (≥ what the short was credited).
        let long_paid = (reference_scaled(100, 1_000_000_000, true) / PREMIUM_SCALE) as u64;
        apply_long_payment(&mut r, long_paid).unwrap();
        assert_eq!(r.premium_pool, long_paid);

        // The short claims again - nothing new accrued, but the carry clears.
        let (paid2, owed2) = claim_short_amount(&s, &r).unwrap();
        assert_eq!((paid2, owed2), (earned, 0));
        apply_short_claim(&mut s, &mut r, paid2, owed2).unwrap();

        assert_eq!(s.premium_receivable, 0, "made whole");
        assert_eq!(r.receivable, 0);
        assert!(r.premium_pool <= 1, "what is left is dust");
    }

    /// V2: unequal shorts split pro-rata, and claims + dust == paid.
    #[test]
    fn v2_unequal_shorts_split_pro_rata_with_dust() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 4_000_000; // 3e6 + 1e6
        r.total_long_liquidity = 1_000_000_000;

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        let paid_in = (reference_scaled(100, 1_000_000_000, true) / PREMIUM_SCALE) as u64;
        apply_long_payment(&mut r, paid_in).unwrap();

        let mut a = position(3_000_000, leg_type::SHORT);
        let mut b = position(1_000_000, leg_type::SHORT);

        let (pa, oa) = claim_short_amount(&a, &r).unwrap();
        apply_short_claim(&mut a, &mut r, pa, oa).unwrap();
        let (pb, ob) = claim_short_amount(&b, &r).unwrap();
        apply_short_claim(&mut b, &mut r, pb, ob).unwrap();

        assert_eq!(pa, reference_claim(100, 1_000_000_000, 4_000_000, 3_000_000));
        assert_eq!(pb, reference_claim(100, 1_000_000_000, 4_000_000, 1_000_000));
        assert!(pa.abs_diff(3 * pb) <= 3, "3:1 pro rata: {pa} vs {pb}");
        assert_eq!((oa, ob), (0, 0));
        assert!(r.premium_pool <= 3, "dust");
        assert_eq!(pa + pb + r.premium_pool, paid_in, "claims + dust == paid");
    }

    /// V3: three equal shorts.
    #[test]
    fn v3_equal_shorts_split_evenly_with_dust() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 3_000_000;
        r.total_long_liquidity = 1_000_000_000;

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();
        let paid_in = (reference_scaled(100, 1_000_000_000, true) / PREMIUM_SCALE) as u64;
        apply_long_payment(&mut r, paid_in).unwrap();

        let each = reference_claim(100, 1_000_000_000, 3_000_000, 1_000_000);
        let mut total = 0u64;
        for _ in 0..3 {
            let mut s = position(1_000_000, leg_type::SHORT);
            let (p, o) = claim_short_amount(&s, &r).unwrap();
            apply_short_claim(&mut s, &mut r, p, o).unwrap();
            assert_eq!(p, each);
            assert_eq!(o, 0);
            total += p;
        }
        assert!(r.premium_pool <= 3, "dust");
        assert_eq!(total + r.premium_pool, paid_in, "claims + dust == paid");
    }

    /// Claiming twice in the same slot must not pay twice.
    #[test]
    fn a_second_claim_in_the_same_slot_pays_nothing() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 1_000_000;
        r.total_long_liquidity = 1_000_000_000;
        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();
        apply_long_payment(&mut r, (reference_scaled(100, 1_000_000_000, true) / PREMIUM_SCALE) as u64).unwrap();

        let mut s = position(1_000_000, leg_type::SHORT);
        let (p1, o1) = claim_short_amount(&s, &r).unwrap();
        apply_short_claim(&mut s, &mut r, p1, o1).unwrap();
        assert!(p1 > 0);

        let (p2, o2) = claim_short_amount(&s, &r).unwrap();
        assert_eq!((p2, o2), (0, 0), "checkpoint rolled forward; nothing new");
    }

    #[test]
    fn a_short_joining_late_earns_nothing_for_earlier_periods() {
        let (m, mut i) = (market(), index());
        let mut r = range();
        r.total_short_liquidity = 1_000_000;
        r.total_long_liquidity = 1_000_000_000;

        update_index(&mut i, RATE, 100).unwrap();
        poke_range(&i, &m, &mut r).unwrap();

        // Latecomer checkpoints at the current accumulator.
        let mut late = position(1_000_000, leg_type::SHORT);
        late.entry_acc_q64 = r.acc_premium_per_short_q64;
        assert_eq!(claimable_for(&late, &r), 0, "no entitlement for the past");
    }
}
