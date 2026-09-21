//! Factory (Allowlisted Market) - component 02.
//!
//! Owns the protocol admin and the single-pool allowlist, and supplies the
//! authorization guards that `create_market` runs before any Whirlpool read.
//! Spec: `docs/02-mvp-components/02-factory-allowlisted-market.md`.
//!
//! Deliberately thin: market *geometry* is read by the adapter path in
//! `lib.rs`, which components 01/01B already proved against a live pool. This
//! module adds only who-may-call and which-pool.

use anchor_lang::prelude::*;

use crate::errors::PermaError;
use crate::state::GlobalConfig;

/// An allowlist entry must be a real pubkey.
///
/// The default (all-zero) key is never a valid account address, and accepting
/// it would create a `GlobalConfig` that can never authorize any market - a
/// silent brick rather than a loud failure.
pub fn validate_allowlist_entry(whirlpool: &Pubkey) -> Result<()> {
    require_keys_neq!(
        *whirlpool,
        Pubkey::default(),
        PermaError::InvalidAllowlistEntry
    );
    Ok(())
}

/// Only the recorded `GlobalConfig.admin` may call an admin instruction
/// (`create_market`, `pause_market`, `unpause_market`, `set_market_risk_params`,
/// `transfer_admin`, `unwind_empty_range`).
pub fn require_admin(config: &GlobalConfig, admin: &Pubkey) -> Result<()> {
    require_keys_eq!(*admin, config.admin, PermaError::Unauthorized);
    Ok(())
}

/// A new admin must be a real pubkey.
///
/// The all-zero key has no private key, so transferring to it would leave a
/// `GlobalConfig` nobody can ever sign for - pause, unpause and risk params
/// would all be permanently unreachable. Same reasoning as
/// [`validate_allowlist_entry`], and the reason the check lives here rather
/// than inline: a pure function is unit-testable without a validator.
pub fn validate_new_admin(new_admin: &Pubkey) -> Result<()> {
    require_keys_neq!(*new_admin, Pubkey::default(), PermaError::InvalidAdmin);
    Ok(())
}

/// Gate `create_market` on admin identity and the allowlist.
///
/// Order matters, cheapest and most restrictive first:
///
/// 1. **Admin** - only the recorded admin may create markets.
/// 2. **Allowlist** - only the single approved Whirlpool.
///
/// Everything downstream (Whirlpool program ID, active rewards, live geometry,
/// PERMA vault mint/owner) is unchanged from component 01 and runs after this.
///
/// > Consequence worth knowing: because the allowlist check precedes the
/// > active-rewards check, a rewards-bearing pool fails with
/// > `PoolNotAllowlisted`, never `InvalidAsset`. The rewards guard is therefore
/// > defense-in-depth on the allowlisted pool itself. Proven directly by
/// > `tests/factory-rewards.ts`.
pub fn authorize_create_market(
    config: &GlobalConfig,
    admin: &Pubkey,
    whirlpool: &Pubkey,
) -> Result<()> {
    require_admin(config, admin)?;
    require_keys_eq!(
        *whirlpool,
        config.allowlisted_whirlpool,
        PermaError::PoolNotAllowlisted
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(admin: Pubkey, pool: Pubkey) -> GlobalConfig {
        GlobalConfig {
            admin,
            allowlisted_whirlpool: pool,
            bump: 255,
        }
    }

    #[test]
    fn rejects_default_pubkey_as_allowlist_entry() {
        assert!(validate_allowlist_entry(&Pubkey::default()).is_err());
        assert!(validate_allowlist_entry(&Pubkey::new_unique()).is_ok());
    }

    #[test]
    fn authorizes_only_the_recorded_admin_and_pool() {
        let admin = Pubkey::new_unique();
        let pool = Pubkey::new_unique();
        let cfg = config(admin, pool);

        assert!(authorize_create_market(&cfg, &admin, &pool).is_ok());
        // Wrong admin, right pool.
        assert!(authorize_create_market(&cfg, &Pubkey::new_unique(), &pool).is_err());
        // Right admin, wrong pool.
        assert!(authorize_create_market(&cfg, &admin, &Pubkey::new_unique()).is_err());
    }

    #[test]
    fn rejects_default_pubkey_as_new_admin() {
        // Transferring to the zero key would brick every admin path at once,
        // with no way back - the one transfer that must never succeed.
        assert!(validate_new_admin(&Pubkey::default()).is_err());
        assert!(validate_new_admin(&Pubkey::new_unique()).is_ok());
    }

    #[test]
    fn admin_check_precedes_allowlist_check() {
        // A non-admin passing a non-allowlisted pool must be told it is
        // unauthorized - the identity failure is the more fundamental one and
        // must not leak which pool is allowlisted.
        let cfg = config(Pubkey::new_unique(), Pubkey::new_unique());
        let err = authorize_create_market(&cfg, &Pubkey::new_unique(), &Pubkey::new_unique())
            .unwrap_err();
        assert!(
            format!("{err:?}").contains("Unauthorized"),
            "expected Unauthorized, got {err:?}"
        );
    }
}
