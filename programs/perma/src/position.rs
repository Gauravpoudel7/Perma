//! Position Engine - components 04 + 05, short path.
//!
//! Pure accounting over [`PermaPosition`] and [`UserCollateral`]. The
//! instruction layer in `lib.rs` runs the Orca CPIs and measures vault deltas;
//! this module decides what the books become. Splitting them keeps the
//! money-moving rules unit-testable without a validator.
//!
//! # The conservation rule
//!
//! Per side `s`, across the whole market:
//!
//! ```text
//! vault_s + Σ in_orca_s  ==  Σ_users (balance_s + locked_s)
//! ```
//!
//! Mint locks the **observed** spend `S` and moves it into Orca. Burn gets back
//! `G`, which differs from `S` under impermanent loss or accrued fees. The only
//! rule that keeps the identity true is:
//!
//! ```text
//! locked -= S     // what this position recorded at mint
//! free   += G     // what Orca actually returned
//! ```
//!
//! `G - S` is realized PnL, absorbed into free balance. No PnL field is
//! invented - Fair MVP has no use for one until components 08/09.

use anchor_lang::prelude::*;

use crate::collateral::Side;
use crate::errors::PermaError;
use crate::state::{leg_type, position_status, PermaPosition, UserCollateral};

/// Observed result of the mint CPIs.
pub struct MintOutcome {
    pub liquidity: u128,
    pub spent_a: u64,
    pub spent_b: u64,
}

/// Observed result of the burn CPIs.
pub struct BurnOutcome {
    pub returned_a: u64,
    pub returned_b: u64,
}

/// Record a freshly opened short: lock the observed spend, track the exposure,
/// and mark the user as having a live position.
///
/// Called **after** the Orca CPIs, with measured vault deltas - never with the
/// caller's quoted maximums.
pub(crate) fn open_short(
    position: &mut PermaPosition,
    user: &mut UserCollateral,
    outcome: &MintOutcome,
) -> Result<()> {
    // Move exactly what was spent from free into locked.
    crate::collateral::lock(user, Side::A, outcome.spent_a)?;
    crate::collateral::lock(user, Side::B, outcome.spent_b)?;

    position.liquidity = position
        .liquidity
        .checked_add(outcome.liquidity)
        .ok_or(PermaError::MathOverflow)?;
    position.in_orca_a = position
        .in_orca_a
        .checked_add(outcome.spent_a)
        .ok_or(PermaError::MathOverflow)?;
    position.in_orca_b = position
        .in_orca_b
        .checked_add(outcome.spent_b)
        .ok_or(PermaError::MathOverflow)?;
    position.locked_a = position
        .locked_a
        .checked_add(outcome.spent_a)
        .ok_or(PermaError::MathOverflow)?;
    position.locked_b = position
        .locked_b
        .checked_add(outcome.spent_b)
        .ok_or(PermaError::MathOverflow)?;

    position.leg_type = leg_type::SHORT;
    position.status = position_status::OPEN;

    // Closes the component-03 residual: `unlock_collateral` reads this counter
    // but nothing ever incremented it, leaving the guard inert.
    user.open_positions = user
        .open_positions
        .checked_add(1)
        .ok_or(PermaError::MathOverflow)?;

    Ok(())
}

/// Settle a closed short.
///
/// Releases the collateral this position locked and credits whatever Orca
/// actually returned. See the module docs for why those two numbers differ and
/// why using either one for both sides would break conservation.
///
/// Ends `Closed`, or **`PendingPremium`** when the short earned premium no long
/// has funded yet: the position's Orca liquidity is gone but the account has to
/// survive to carry `premium_receivable` until `settle_premium` pays it
/// (`08-burn-settle.md` §E). The caller must have claimed *before* the
/// `total_short_liquidity` decrement, or the share is computed against a
/// denominator this position is no longer part of.
pub(crate) fn close_short(
    position: &mut PermaPosition,
    user: &mut UserCollateral,
    outcome: &BurnOutcome,
) -> Result<()> {
    require!(
        position.status == position_status::OPEN,
        PermaError::PositionAlreadyClosed
    );

    // Decrement the counter first: `unlock` refuses while it is non-zero, and
    // this position no longer justifies the block.
    user.open_positions = user
        .open_positions
        .checked_sub(1)
        .ok_or(PermaError::MathOverflow)?;

    // locked -= S (what this position reserved at mint)
    let (locked_a, locked_b) = (position.locked_a, position.locked_b);
    let free_a = user
        .balance_a
        .checked_add(outcome.returned_a)
        .ok_or(PermaError::MathOverflow)?;
    let free_b = user
        .balance_b
        .checked_add(outcome.returned_b)
        .ok_or(PermaError::MathOverflow)?;
    user.locked_a = user
        .locked_a
        .checked_sub(locked_a)
        .ok_or(PermaError::InsufficientFunds)?;
    user.locked_b = user
        .locked_b
        .checked_sub(locked_b)
        .ok_or(PermaError::InsufficientFunds)?;
    // free += G (what Orca actually returned)
    user.balance_a = free_a;
    user.balance_b = free_b;

    position.liquidity = 0;
    position.in_orca_a = 0;
    position.in_orca_b = 0;
    position.locked_a = 0;
    position.locked_b = 0;
    position.status = if position.premium_receivable > 0 {
        position_status::PENDING_PREMIUM
    } else {
        position_status::CLOSED
    };

    Ok(())
}

// --- Long path (component 06) --------------------------------------------
//
// A long has no Orca position and moves no tokens: it buys the right to the
// price exposure of short liquidity someone else already provided. So it never
// touches `in_orca_*`, `locked_*`, the vaults, or `open_positions` - that
// counter means "locked collateral is backing a live short", and a long locks
// nothing (see IMPL-06-FEASIBILITY.md Q4/Q5).

/// Record a freshly opened long.
///
/// Callers must already have run `update_index` -> `poke_range` and checked the
/// inventory gate; this only writes the books.
pub(crate) fn open_long(
    position: &mut PermaPosition,
    user: &mut UserCollateral,
    size: u128,
    current_index: u128,
) -> Result<()> {
    // The solvency gate (component 09) counts the user's open longs against
    // this figure, so it is maintained in the same function that changes the
    // status - never at a call site that could be forgotten.
    user.open_longs = user
        .open_longs
        .checked_add(1)
        .ok_or(PermaError::MathOverflow)?;

    position.liquidity = size;
    position.leg_type = leg_type::LONG;
    position.status = position_status::OPEN;

    // Orca fields stay default - a long has no position to own.
    position.orca_position = Pubkey::default();
    position.position_mint = Pubkey::default();
    position.in_orca_a = 0;
    position.in_orca_b = 0;
    position.locked_a = 0;
    position.locked_b = 0;

    // Checkpoint at *now*, so this long owes nothing for periods before it
    // existed - the mirror of `entry_acc_q64` on the short side.
    position.entry_index = current_index;
    position.accrued_scaled = 0;

    Ok(())
}

/// Close a long.
///
/// **Writes no liability.** Before component 08 this parked the accrued premium
/// on `UserCollateral.premium_owed_usdc` with no cash behind it; the caller now
/// settles in USDC *before* calling this, and a long that cannot pay does not
/// close at all (`08-burn-settle.md` §G). Recording a debt here again would
/// reintroduce exactly the liability-without-cash state 08 removed.
pub(crate) fn close_long(position: &mut PermaPosition, user: &mut UserCollateral) -> Result<()> {
    require!(
        position.status == position_status::OPEN,
        PermaError::PositionAlreadyClosed
    );

    // `checked_sub`, so a drifted counter fails loudly instead of silently
    // under-counting the next solvency check.
    user.open_longs = user
        .open_longs
        .checked_sub(1)
        .ok_or(PermaError::MathOverflow)?;

    position.liquidity = 0;
    position.status = position_status::CLOSED;
    Ok(())
}

/// Reduce tracked exposure after a partial `decrease_liquidity_v2`.
///
/// Used by the low-level harness path so `in_orca_*` stays **current** rather
/// than cumulative - the bug this session fixes.
pub(crate) fn reduce_exposure(
    position: &mut PermaPosition,
    liquidity_removed: u128,
    returned_a: u64,
    returned_b: u64,
) -> Result<()> {
    position.liquidity = position
        .liquidity
        .checked_sub(liquidity_removed)
        .ok_or(PermaError::MathOverflow)?;
    // Saturating here is correct and deliberate: Orca can return slightly more
    // than was deposited (accrued fees), and exposure must floor at zero rather
    // than wrap. This is a measured-delta reconciliation, not a balance.
    position.in_orca_a = position.in_orca_a.saturating_sub(returned_a);
    position.in_orca_b = position.in_orca_b.saturating_sub(returned_b);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn position() -> PermaPosition {
        PermaPosition {
            market: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            orca_position: Pubkey::new_unique(),
            position_mint: Pubkey::new_unique(),
            tick_lower: -40176,
            tick_upper: -38168,
            liquidity: 0,
            in_orca_a: 0,
            in_orca_b: 0,
            locked_a: 0,
            locked_b: 0,
            leg_type: leg_type::SHORT,
            status: position_status::OPEN,
            entry_index: 0,
            accrued_scaled: 0,
            entry_acc_q64: 0,
            premium_receivable: 0,
            nonce: 1,
            bump: 255,
        }
    }

    /// A short with an unfunded claim must stay alive to carry it.
    #[test]
    fn a_short_owed_unfunded_premium_ends_pending_not_closed() {
        let mut u = user(10_000, 10_000);
        let mut p = position();
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 1, spent_a: 3_000, spent_b: 2_000 }).unwrap();
        p.premium_receivable = 99_999;

        close_short(&mut p, &mut u, &BurnOutcome { returned_a: 3_000, returned_b: 2_000 }).unwrap();

        assert_eq!(p.status, position_status::PENDING_PREMIUM);
        assert_eq!(p.premium_receivable, 99_999, "the claim survives the close");
        assert_eq!(u.open_positions, 0, "collateral is still released");
        assert_eq!(u.locked_a, 0);
    }

    /// The long counter moves with status and never goes negative.
    #[test]
    fn open_longs_counter_tracks_status_and_fails_closed() {
        let mut u = user(0, 10_000_000);
        let mut p = position();
        open_long(&mut p, &mut u, 1_000, 0).unwrap();
        assert_eq!(u.open_longs, 1);
        let mut p2 = position();
        open_long(&mut p2, &mut u, 1_000, 0).unwrap();
        assert_eq!(u.open_longs, 2);

        close_long(&mut p, &mut u).unwrap();
        assert_eq!(u.open_longs, 1);
        assert!(close_long(&mut p, &mut u).is_err(), "already closed");
        assert_eq!(u.open_longs, 1, "a refused close does not touch the counter");

        close_long(&mut p2, &mut u).unwrap();
        assert_eq!(u.open_longs, 0);
        // Drift: a close with the counter already at zero fails, not wraps.
        let mut p3 = position();
        p3.status = position_status::OPEN;
        p3.leg_type = leg_type::LONG;
        assert!(close_long(&mut p3, &mut u).is_err());
    }

    /// vault + Σ in_orca == Σ(free + locked), simulated with one user.
    fn conserved(u: &UserCollateral, p: &PermaPosition, vault_a: u64, vault_b: u64) -> bool {
        vault_a + p.in_orca_a == u.balance_a + u.locked_a
            && vault_b + p.in_orca_b == u.balance_b + u.locked_b
    }

    #[test]
    fn mint_locks_the_observed_spend_and_tracks_exposure() {
        let (mut u, mut p) = (user(10_000, 10_000), position());
        let vault = (10_000u64, 10_000u64);

        open_short(
            &mut p,
            &mut u,
            &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 2_000 },
        )
        .unwrap();

        assert_eq!((u.balance_a, u.locked_a), (7_000, 3_000));
        assert_eq!((u.balance_b, u.locked_b), (8_000, 2_000));
        assert_eq!((p.in_orca_a, p.in_orca_b), (3_000, 2_000));
        assert_eq!((p.locked_a, p.locked_b), (3_000, 2_000));
        assert_eq!(u.open_positions, 1, "the 03 guard must become live");

        // Tokens left the vault into Orca.
        assert!(conserved(&u, &p, vault.0 - 3_000, vault.1 - 2_000));
    }

    #[test]
    fn burn_at_break_even_restores_the_user_exactly() {
        let (mut u, mut p) = (user(10_000, 10_000), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 2_000 })
            .unwrap();

        close_short(&mut p, &mut u, &BurnOutcome { returned_a: 3_000, returned_b: 2_000 }).unwrap();

        assert_eq!((u.balance_a, u.locked_a), (10_000, 0));
        assert_eq!((u.balance_b, u.locked_b), (10_000, 0));
        assert_eq!(u.open_positions, 0);
        assert_eq!(p.status, position_status::CLOSED);
        assert!(conserved(&u, &p, 10_000, 10_000));
    }

    /// Impermanent loss: Orca returns less than went in. The user eats it.
    #[test]
    fn burn_with_impermanent_loss_conserves() {
        let (mut u, mut p) = (user(10_000, 10_000), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 2_000 })
            .unwrap();

        close_short(&mut p, &mut u, &BurnOutcome { returned_a: 2_850, returned_b: 2_000 }).unwrap();

        assert_eq!(u.balance_a, 9_850, "150 of realized loss");
        assert_eq!(u.locked_a, 0, "the full locked amount is released");
        // The vault only got 2_850 back, and the books agree.
        assert!(conserved(&u, &p, 9_850, 10_000));
    }

    /// Accrued Whirlpool fees: Orca returns more than went in.
    #[test]
    fn burn_with_fee_gain_conserves() {
        let (mut u, mut p) = (user(10_000, 10_000), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 2_000 })
            .unwrap();

        close_short(&mut p, &mut u, &BurnOutcome { returned_a: 3_120, returned_b: 2_000 }).unwrap();

        assert_eq!(u.balance_a, 10_120, "120 of realized gain");
        assert!(conserved(&u, &p, 10_120, 10_000));
    }

    /// Two shorts open at once: burning one must not touch the other's lock.
    #[test]
    fn multi_short_attribution_is_per_position() {
        let mut u = user(10_000, 10_000);
        let (mut p1, mut p2) = (position(), position());
        p2.nonce = 2;

        open_short(&mut p1, &mut u, &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 0 })
            .unwrap();
        open_short(&mut p2, &mut u, &MintOutcome { liquidity: 700, spent_a: 1_500, spent_b: 0 })
            .unwrap();
        assert_eq!(u.locked_a, 4_500);
        assert_eq!(u.open_positions, 2);

        // Burn the SECOND one; only its 1_500 comes back.
        close_short(&mut p2, &mut u, &BurnOutcome { returned_a: 1_500, returned_b: 0 }).unwrap();

        assert_eq!(u.locked_a, 3_000, "position 1's lock must survive");
        assert_eq!(p1.locked_a, 3_000, "position 1 untouched");
        assert_eq!(u.open_positions, 1, "still one short open");
        assert_eq!(p1.status, position_status::OPEN);
    }

    #[test]
    fn double_burn_is_rejected() {
        let (mut u, mut p) = (user(10_000, 0), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 500, spent_a: 3_000, spent_b: 0 })
            .unwrap();
        close_short(&mut p, &mut u, &BurnOutcome { returned_a: 3_000, returned_b: 0 }).unwrap();

        assert!(close_short(&mut p, &mut u, &BurnOutcome { returned_a: 1, returned_b: 0 }).is_err());
        assert_eq!(u.open_positions, 0, "the counter must not go negative");
    }

    #[test]
    fn mint_beyond_free_balance_is_rejected() {
        let (mut u, mut p) = (user(100, 0), position());
        assert!(open_short(
            &mut p,
            &mut u,
            &MintOutcome { liquidity: 1, spent_a: 101, spent_b: 0 }
        )
        .is_err());
    }

    /// The bug this session fixes: exposure must be current, not cumulative.
    #[test]
    fn reduce_exposure_tracks_current_not_cumulative() {
        let (mut u, mut p) = (user(10_000, 10_000), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 1_000, spent_a: 3_000, spent_b: 2_000 })
            .unwrap();

        // Remove half.
        reduce_exposure(&mut p, 500, 1_500, 1_000).unwrap();
        assert_eq!(p.liquidity, 500);
        assert_eq!((p.in_orca_a, p.in_orca_b), (1_500, 1_000), "exposure halved, not doubled");

        // Remove the rest.
        reduce_exposure(&mut p, 500, 1_500, 1_000).unwrap();
        assert_eq!(p.liquidity, 0);
        assert_eq!((p.in_orca_a, p.in_orca_b), (0, 0));
    }

    #[test]
    fn reduce_exposure_floors_at_zero_when_fees_exceed_deposit() {
        let (mut u, mut p) = (user(10_000, 0), position());
        open_short(&mut p, &mut u, &MintOutcome { liquidity: 100, spent_a: 1_000, spent_b: 0 })
            .unwrap();

        // Orca returns more than went in (fees). Exposure floors rather than wraps.
        reduce_exposure(&mut p, 100, 1_050, 0).unwrap();
        assert_eq!(p.in_orca_a, 0);
    }
}
