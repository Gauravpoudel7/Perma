//! Collateral accounting - component 03.
//!
//! Pure functions over [`UserCollateral`]. No account loading, no CPI, no
//! signing: the instruction layer in `lib.rs` validates accounts and moves
//! tokens; this module decides what the numbers become. Splitting them that way
//! is what makes the ledger exhaustively unit-testable.
//!
//! **Every operation uses checked arithmetic.** Deliberately no `saturating_*`
//! on balances - a silent clamp is how a ledger quietly loses money. A
//! saturating subtraction on `balance_b` would turn an underflow bug into a
//! free-money bug that no test would catch.
//!
//! Spec: `docs/02-mvp-components/03-collateral-manager.md`.
//! Premium seniority: `docs/adr/ADR-0002-premium-accounting.md`.

use anchor_lang::prelude::*;

use crate::errors::PermaError;
use crate::state::UserCollateral;

/// Which asset a call operates on. `A` is the market's `token_mint_a` (WSOL),
/// `B` is `token_mint_b` (devUSDC) - the same ordering as `Market.vault_a/b`,
/// so there is no mapping to get wrong.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    A,
    B,
}

impl UserCollateral {
    #[inline]
    pub fn free(&self, side: Side) -> u64 {
        match side {
            Side::A => self.balance_a,
            Side::B => self.balance_b,
        }
    }

    #[inline]
    pub fn locked(&self, side: Side) -> u64 {
        match side {
            Side::A => self.locked_a,
            Side::B => self.locked_b,
        }
    }

    /// Everything this user owns on `side`, free or committed.
    ///
    /// The per-user term of the conservation invariant.
    #[inline]
    pub fn total(&self, side: Side) -> Result<u64> {
        self.free(side)
            .checked_add(self.locked(side))
            .ok_or_else(|| PermaError::MathOverflow.into())
    }

    #[inline]
    fn set_free(&mut self, side: Side, v: u64) {
        match side {
            Side::A => self.balance_a = v,
            Side::B => self.balance_b = v,
        }
    }

    #[inline]
    fn set_locked(&mut self, side: Side, v: u64) {
        match side {
            Side::A => self.locked_a = v,
            Side::B => self.locked_b = v,
        }
    }
}

/// Credit a deposit to free balance. Tokens must already have moved into the
/// market vault, or be moving in the same instruction.
pub(crate) fn deposit(user: &mut UserCollateral, side: Side, amount: u64) -> Result<()> {
    let next = user
        .free(side)
        .checked_add(amount)
        .ok_or(PermaError::MathOverflow)?;
    user.set_free(side, next);
    Ok(())
}

/// Debit a withdrawal from **free** balance.
///
/// `locked_*` is not reachable here - withdrawal touches free only, so locked
/// collateral is protected by construction rather than by a check that a future
/// refactor could drop.
pub(crate) fn withdraw_free(user: &mut UserCollateral, side: Side, amount: u64) -> Result<()> {
    let next = user
        .free(side)
        .checked_sub(amount)
        .ok_or(PermaError::InsufficientFunds)?;
    user.set_free(side, next);
    Ok(())
}

/// Move free -> locked. Accounting only; no tokens leave the vault.
///
/// Component 05 will call this before the adapter CPI so the tokens the adapter
/// is about to spend are already reserved.
pub(crate) fn lock(user: &mut UserCollateral, side: Side, amount: u64) -> Result<()> {
    let free_next = user
        .free(side)
        .checked_sub(amount)
        .ok_or(PermaError::InsufficientFunds)?;
    let locked_next = user
        .locked(side)
        .checked_add(amount)
        .ok_or(PermaError::MathOverflow)?;
    user.set_free(side, free_next);
    user.set_locked(side, locked_next);
    Ok(())
}

/// Move locked -> free.
///
/// Refuses while `open_positions > 0`: those positions are what the locked
/// funds back. The counter is always zero until component 05 increments it, so
/// this is inert today and load-bearing the moment mint exists.
pub(crate) fn unlock(user: &mut UserCollateral, side: Side, amount: u64) -> Result<()> {
    require!(
        user.open_positions == 0,
        PermaError::PositionsOutstanding
    );
    let locked_next = user
        .locked(side)
        .checked_sub(amount)
        .ok_or(PermaError::InsufficientFunds)?;
    let free_next = user
        .free(side)
        .checked_add(amount)
        .ok_or(PermaError::MathOverflow)?;
    user.set_locked(side, locked_next);
    user.set_free(side, free_next);
    Ok(())
}

// --- Premium hooks (component 07/08 callers) -----------------------------
//
// `pub(crate)` on purpose. The real callers are `settle_premium` and the burn
// paths, which do not exist yet. Exposing these as an admin-gated instruction
// just to test them would ship a deployed path where the admin can move user
// funds - so the arithmetic is proven here by unit tests, and the matching
// token transfer between `Market.vault_b` and the range vault lands with
// component 08. See IMPL-03-FEASIBILITY.md Q4.

/// Debit accrued premium from a long's **free USDC**.
///
/// Premium is a senior claim (ADR-0002) but seniority does **not** mean it may
/// raid `locked_b`: locked funds back a short that has real Orca liquidity
/// behind it. Taking them to pay a long's premium would move another user's
/// collateral. Fails `InsufficientCollateralForLoss` instead.
pub(crate) fn debit_usdc(user: &mut UserCollateral, amount: u64) -> Result<()> {
    let next = user
        .balance_b
        .checked_sub(amount)
        .ok_or(PermaError::InsufficientCollateralForLoss)?;
    user.balance_b = next;
    Ok(())
}

/// Credit settled premium to a short's free USDC.
pub(crate) fn credit_usdc(user: &mut UserCollateral, amount: u64) -> Result<()> {
    let next = user
        .balance_b
        .checked_add(amount)
        .ok_or(PermaError::MathOverflow)?;
    user.balance_b = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> UserCollateral {
        UserCollateral {
            market: Pubkey::new_unique(),
            owner: Pubkey::new_unique(),
            balance_a: 0,
            locked_a: 0,
            balance_b: 0,
            locked_b: 0,
            premium_owed_usdc: 0,
            open_positions: 0,
            bump: 255,
            open_longs: 0,
        }
    }

    fn funded(a: u64, b: u64) -> UserCollateral {
        let mut u = user();
        u.balance_a = a;
        u.balance_b = b;
        u
    }

    #[test]
    fn deposit_then_withdraw_round_trips_exactly() {
        let mut u = user();
        deposit(&mut u, Side::A, 1_000).unwrap();
        deposit(&mut u, Side::B, 2_500).unwrap();
        assert_eq!((u.balance_a, u.balance_b), (1_000, 2_500));

        withdraw_free(&mut u, Side::A, 1_000).unwrap();
        withdraw_free(&mut u, Side::B, 2_500).unwrap();
        assert_eq!((u.balance_a, u.balance_b), (0, 0));
    }

    #[test]
    fn withdraw_beyond_free_is_rejected_not_clamped() {
        let mut u = funded(100, 0);
        assert!(withdraw_free(&mut u, Side::A, 101).is_err());
        // The failed attempt must leave the balance untouched.
        assert_eq!(u.balance_a, 100);
    }

    #[test]
    fn lock_moves_free_to_locked_and_conserves_the_total() {
        let mut u = funded(1_000, 0);
        let before = u.total(Side::A).unwrap();

        lock(&mut u, Side::A, 400).unwrap();
        assert_eq!((u.balance_a, u.locked_a), (600, 400));
        assert_eq!(u.total(Side::A).unwrap(), before, "lock must not mint or burn");
    }

    #[test]
    fn withdraw_cannot_reach_locked_funds() {
        let mut u = funded(1_000, 0);
        lock(&mut u, Side::A, 900).unwrap();
        // Only 100 is free; 900 is committed to a short.
        assert!(withdraw_free(&mut u, Side::A, 101).is_err());
        withdraw_free(&mut u, Side::A, 100).unwrap();
        assert_eq!((u.balance_a, u.locked_a), (0, 900));
    }

    #[test]
    fn lock_beyond_free_is_rejected() {
        let mut u = funded(50, 0);
        assert!(lock(&mut u, Side::A, 51).is_err());
        assert_eq!((u.balance_a, u.locked_a), (50, 0));
    }

    #[test]
    fn unlock_restores_free_and_conserves_the_total() {
        let mut u = funded(0, 1_000);
        lock(&mut u, Side::B, 1_000).unwrap();
        let before = u.total(Side::B).unwrap();

        unlock(&mut u, Side::B, 600).unwrap();
        assert_eq!((u.balance_b, u.locked_b), (600, 400));
        assert_eq!(u.total(Side::B).unwrap(), before);
    }

    #[test]
    fn unlock_beyond_locked_is_rejected() {
        let mut u = funded(0, 100);
        lock(&mut u, Side::B, 100).unwrap();
        assert!(unlock(&mut u, Side::B, 101).is_err());
        assert_eq!(u.locked_b, 100);
    }

    /// The hole component 05 would otherwise have to remember to close.
    #[test]
    fn unlock_is_blocked_while_positions_are_open() {
        let mut u = funded(1_000, 0);
        lock(&mut u, Side::A, 1_000).unwrap();

        u.open_positions = 1;
        assert!(
            unlock(&mut u, Side::A, 1).is_err(),
            "locked collateral backing a live short must not be unlockable"
        );

        u.open_positions = 0;
        unlock(&mut u, Side::A, 1_000).unwrap();
        assert_eq!(u.balance_a, 1_000);
    }

    #[test]
    fn debit_usdc_takes_only_free_never_locked() {
        let mut u = funded(0, 1_000);
        lock(&mut u, Side::B, 700).unwrap(); // 300 free, 700 locked

        // 301 exceeds free even though the user "has" 1000 in total.
        assert!(debit_usdc(&mut u, 301).is_err());
        assert_eq!((u.balance_b, u.locked_b), (300, 700), "state unchanged on failure");

        debit_usdc(&mut u, 300).unwrap();
        assert_eq!((u.balance_b, u.locked_b), (0, 700));
    }

    #[test]
    fn debit_credit_usdc_round_trip_is_exact() {
        let mut u = funded(0, 500);
        debit_usdc(&mut u, 123).unwrap();
        credit_usdc(&mut u, 123).unwrap();
        assert_eq!(u.balance_b, 500);
    }

    #[test]
    fn credit_usdc_overflow_is_rejected() {
        let mut u = funded(0, u64::MAX);
        assert!(credit_usdc(&mut u, 1).is_err());
        assert_eq!(u.balance_b, u64::MAX);
    }

    #[test]
    fn sides_are_independent() {
        let mut u = funded(100, 200);
        lock(&mut u, Side::A, 100).unwrap();
        assert_eq!(u.balance_b, 200, "side A must not disturb side B");
        assert_eq!(u.locked_b, 0);
    }

    /// The per-user half of the conservation invariant: no sequence of
    /// operations that neither deposits nor withdraws may change the total.
    #[test]
    fn internal_moves_never_change_the_total() {
        let mut u = funded(1_000, 1_000);
        let (ta, tb) = (u.total(Side::A).unwrap(), u.total(Side::B).unwrap());

        lock(&mut u, Side::A, 300).unwrap();
        lock(&mut u, Side::B, 900).unwrap();
        unlock(&mut u, Side::A, 100).unwrap();
        unlock(&mut u, Side::B, 400).unwrap();
        lock(&mut u, Side::A, 50).unwrap();

        assert_eq!(u.total(Side::A).unwrap(), ta);
        assert_eq!(u.total(Side::B).unwrap(), tb);
    }
}
