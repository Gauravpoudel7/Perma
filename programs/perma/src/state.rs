//! Minimal PERMA state for component 01.
//!
//! Only what the CLMM Adapter needs: the allowlisted `Market`, the
//! `market_authority` PDA that signs every Orca CPI, and the per-short position
//! record. Components 02-11 extend this; nothing here anticipates them.

use anchor_lang::prelude::*;

/// Seed prefixes. Kept in one place so PDA derivation never drifts between
/// the program and the tests.
pub mod seeds {
    pub const GLOBAL_CONFIG: &[u8] = b"global_config";
    pub const MARKET: &[u8] = b"market";
    pub const MARKET_AUTHORITY: &[u8] = b"market_authority";
    pub const PERMA_POSITION: &[u8] = b"perma_position";
    pub const COLLATERAL: &[u8] = b"collateral";
    pub const PREMIUM_INDEX: &[u8] = b"premium_index";
    /// Per-range premium ledger. Full seeds:
    /// `[RANGE, market, tick_lower.to_le_bytes(), tick_upper.to_le_bytes()]`
    ///
    /// ⚠️ **`to_le_bytes`, not `to_string`.** Orca's TickArray PDA uses the
    /// *decimal ASCII* form of its start index (`01-clmm-adapter-orca.md` §C.4).
    /// Two tick-keyed PDAs in one program with opposite encodings is a live
    /// footgun - this one is 4 raw little-endian bytes per tick.
    pub const RANGE: &[u8] = b"range";
    /// Per-range premium escrow. Full seeds:
    /// `[RANGE_VAULT, market, tick_lower.to_le_bytes(), tick_upper.to_le_bytes()]`
    ///
    /// ⚠️ A **PERMA PDA**, deliberately NOT `ATA(market_authority, token_mint_b)`
    /// - that address IS `Market.vault_b`. Sharing one account between premium
    /// escrow and collateral would make both conservation identities
    /// uncheckable (`08-burn-settle.md` §A).
    /// - see `docs/02-mvp-components/08-burn-settle.md` section A.
    pub const RANGE_VAULT: &[u8] = b"range_vault";
}

/// Fair MVP premium defaults. See `docs/02-mvp-components/07-premium-engine.md`
/// section A and ADR-0002. Tuned for **demo visibility**, not derived from an
/// options-pricing model - recalibrate before any market with real size.
pub mod premium_defaults {
    /// Index units per slot. With the multiplier, a long pays
    /// `11_111 × 1 / 1e12` of its notional per slot ≈ 0.01 % per hour
    /// (ADR-0006).
    pub const PREMIUM_RATE: u64 = 11_111;
    /// Scaled µUSDC per (µUSDC of notional × index unit).
    pub const PREMIUM_MULTIPLIER: u64 = 1;
}

/// Demo margin parameters (ADR-0003). **Not fair value.**
///
/// Margin = one horizon of premium on the long's notional plus the buffer:
/// at these defaults ≈ 2.4 % of notional + 1 USDC (ADR-0006).
pub mod risk_defaults {
    /// ~1 day at 400 ms slots (ADR-0006).
    pub const LONG_MARGIN_HORIZON_SLOTS: u64 = 216_000;
    /// 1 USDC.
    pub const LONG_MARGIN_BUFFER_USDC: u64 = 1_000_000;
}

/// Protocol-wide admin and allowlist. Singleton: `PDA(["global_config"])`.
///
/// Fair MVP allowlists **exactly one** Whirlpool, so the allowlist is a single
/// `Pubkey` rather than a collection - the type enforces what `PRD.md` Part A
/// mandates, and the check costs one `require_keys_eq!`.
///
/// There is deliberately **no setter**. The allowlist is fixed at init, so an
/// admin-key compromise cannot repoint the protocol at an attacker-controlled
/// pool while markets hold real Orca positions.
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    /// The only key permitted to call `create_market`.
    pub admin: Pubkey,
    /// The single Whirlpool PERMA will trade against.
    pub allowlisted_whirlpool: Pubkey,
    pub bump: u8,
}

/// The single allowlisted Orca market.
///
/// `tick_spacing`, mints, and vaults are **read from the live Whirlpool account**
/// at `create_market` and cached here - never hardcoded. See
/// `docs/02-mvp-components/02-factory-allowlisted-market.md` section A.
#[account]
#[derive(InitSpace)]
pub struct Market {
    /// The allowlisted Whirlpool. Every adapter CPI is checked against this.
    pub whirlpool: Pubkey,
    /// `Whirlpool.whirlpools_config` - cluster sanity check.
    pub whirlpools_config: Pubkey,
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    pub token_vault_a: Pubkey,
    pub token_vault_b: Pubkey,
    /// PERMA-side vaults (ATAs owned by `market_authority`).
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    /// Copied from the live Whirlpool. Drives every tick alignment check.
    pub tick_spacing: u16,
    /// Must be false for Fair MVP: the close sequence omits `collect_reward_v2`.
    pub has_active_rewards: bool,
    pub is_paused: bool,
    pub authority_bump: u8,
    pub bump: u8,

    // --- Premium parameters (component 02) ---
    // Appended at the end so the adapter's existing field offsets stay stable
    // relative to one another. Admin-set only; no user-reachable write path.
    /// Index units per slot. Default `premium_defaults::PREMIUM_RATE`.
    pub premium_rate: u64,
    /// Converts index × liquidity into µUSDC. Default
    /// `premium_defaults::PREMIUM_MULTIPLIER`.
    pub premium_multiplier: u64,

    // --- Risk parameters (component 09) ---
    // Appended after the premium fields for the same reason. Set from
    // `risk_defaults` at `create_market`; no update path in Fair MVP (10).
    /// Slots of future premium a long must be able to pay from free USDC.
    /// Default `risk_defaults::LONG_MARGIN_HORIZON_SLOTS`.
    pub long_margin_horizon_slots: u64,
    /// Flat µUSDC floor per long, so a dust-sized long still needs real money.
    /// Default `risk_defaults::LONG_MARGIN_BUFFER_USDC`.
    pub long_margin_buffer_usdc: u64,
}

/// Per-user collateral ledger for one market. `PDA(["collateral", market, owner])`.
///
/// **Assets are SPL tokens only.** "SOL collateral" means **wrapped SOL**: side
/// `a` is the market's `token_mint_a` (WSOL, 9 dp) and side `b` is
/// `token_mint_b` (devUSDC, 6 dp). Raw lamports are never tracked here - the
/// vaults and the Orca adapter are SPL end-to-end, so a second representation
/// of the same asset could not be conserved. The spec's `sol_balance` /
/// `usdc_balance` names are superseded; see `IMPL-03-FEASIBILITY.md` Q1.
///
/// Tokens themselves live in `Market.vault_a` / `Market.vault_b`. This account
/// records **who owns how much of them**, which is what makes the conservation
/// invariant checkable:
///
/// ```text
/// vault_s.amount + orca_exposure_s == Σ_users (balance_s + locked_s)
/// ```
///
/// `orca_exposure_s` is component 05's job; in component 03 it is always zero.
#[account]
#[derive(InitSpace)]
pub struct UserCollateral {
    pub market: Pubkey,
    pub owner: Pubkey,

    /// Free WSOL - withdrawable, lockable.
    pub balance_a: u64,
    /// WSOL committed to open shorts. Never withdrawable.
    pub locked_a: u64,
    /// Free devUSDC.
    pub balance_b: u64,
    /// devUSDC committed to open shorts.
    pub locked_b: u64,

    /// Accrued, unsettled premium this user owes as a long (µUSDC).
    ///
    /// **Enforced now, written later.** Withdraw already refuses to leave free
    /// USDC below this figure (premium seniority, ADR-0002); components 07/08
    /// are what will ever set it above zero.
    pub premium_owed_usdc: u64,

    /// Open short positions backed by `locked_*`.
    ///
    /// Gates `unlock_collateral`. Always `0` until component 05 increments it
    /// on mint - so behaviour is unchanged today, but a user can never unlock
    /// collateral backing a live position once mint exists. Closing the hole by
    /// construction rather than by a comment 05 has to remember.
    pub open_positions: u16,

    pub bump: u8,

    // --- Component 09 ---
    // Appended so every earlier offset is unchanged.
    /// Open LONG positions for this user on this market.
    ///
    /// The solvency gate takes every open long as a remaining account and
    /// requires the count to match this exactly (`MissingOpenLong`), so a
    /// caller cannot omit one to under-count their liability. Maintained by
    /// `position::open_long` / `close_long`; bounded by `risk::MAX_OPEN_LONGS`.
    pub open_longs: u16,
}

/// Leg type. Both legs are mintable since component 06.
pub mod leg_type {
    pub const SHORT: u8 = 0;
    pub const LONG: u8 = 1;
}

/// Protocol-wide premium clock. `PDA(["premium_index", market])`.
///
/// A pure function of elapsed slots: `current_index += elapsed × premium_rate`.
/// That is why the poke reward is **zero** - a late poke catches up exactly, so
/// nothing is lost by not calling it (`07-premium-engine.md` §E).
#[account]
#[derive(InitSpace)]
pub struct GlobalPremiumIndex {
    /// Monotonically increasing. Never decreases.
    pub current_index: u128,
    pub last_update_slot: u64,
    pub bump: u8,
}

/// Per-range premium ledger and inventory.
/// `PDA(["range", market, tick_lower_le, tick_upper_le])`.
///
/// Created by the **first short mint** in a range. A long can never create it:
/// a missing range means no short ever provided liquidity there, which is
/// exactly `NoShortInventory`.
///
/// # Cash fields (component 08)
///
/// `premium_pool` and `receivable` are live: the first counts µUSDC actually
/// sitting in the range vault, the second the entitlement no long has funded
/// yet. `dust` is still **declared but never written** - see its own doc.
#[account]
#[derive(InitSpace)]
pub struct RangePremiumState {
    pub market: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,

    /// Sum of all open short liquidity. **The premium pro-rata denominator.**
    ///
    /// Never reduced by a long. Using the available remainder as the
    /// denominator would over-pay shorts as longs open, breaking zero-sum
    /// (`06-long-mint-inventory.md`).
    pub total_short_liquidity: u128,
    /// Sum of all open long liquidity. Drives entitlement accrual.
    pub total_long_liquidity: u128,

    /// Cumulative µUSDC earned per unit of short liquidity, Q64.64.
    pub acc_premium_per_short_q64: u128,
    /// `GlobalPremiumIndex.current_index` at the last poke.
    pub last_index: u128,

    // --- Cash fields (component 08) ---
    /// µUSDC actually escrowed in the range vault.
    ///
    /// Maintained so that `range_vault.amount == premium_pool + dust` holds
    /// after every settle path, reconciled over RPC in `tests/settle-premium.ts`
    /// and `scripts/reconcile.mjs`.
    pub premium_pool: u64,
    /// µUSDC shorts have earned that no long has funded yet - the sum of every
    /// position's `premium_receivable` in this range.
    pub receivable: u64,
    /// Floor residue. **Declared, never written.**
    ///
    /// The rounding residue is real but it is not separable: it stays in
    /// `premium_pool`, where it is indistinguishable from entitlement nobody
    /// has claimed yet. Splitting the two would mean recomputing every open
    /// short's claim on every poke, which is the O(n) work the accumulator
    /// exists to avoid. The field is kept because the identity above is stated
    /// with it and because a future component may account for it separately;
    /// it must not be read as "residue so far".
    pub dust: u64,

    pub bump: u8,
}

impl RangePremiumState {
    /// The long-mint gate: short liquidity not already claimed by a long.
    ///
    /// Derived, never stored - storing it would invite using it as the premium
    /// denominator, which is the exact mistake the spec warns about.
    pub fn available_short_liquidity(&self) -> u128 {
        self.total_short_liquidity
            .saturating_sub(self.total_long_liquidity)
    }
}

/// Position lifecycle. `PendingPremium` from `04-position-engine-1leg.md` is
/// deliberately absent - it exists only to hold an unfunded premium claim, and
/// no premium can accrue until component 08.
pub mod position_status {
    pub const OPEN: u8 = 0;
    pub const CLOSED: u8 = 1;
    /// A short that has already withdrawn its Orca liquidity but still holds an
    /// unfunded premium claim. The account stays alive solely to carry
    /// `premium_receivable`; it accrues nothing new, because it is no longer in
    /// `total_short_liquidity`. A later `settle_premium` that clears the
    /// balance closes it and refunds rent (`08-burn-settle.md` §E).
    pub const PENDING_PREMIUM: u8 = 2;
}

/// One PERMA short <-> one Orca position (ADR-0001).
///
/// **Seed deviation.** `04-position-engine-1leg.md` specifies
/// `["position", market, owner, position_id]`; the shipped seeds are
/// `["perma_position", market, owner, nonce]`. Renaming would change every
/// derivable address in the working 01B and 03 suites for no behavioural gain,
/// and there is no deployed state to migrate. Recorded in
/// `IMPL-04-05-FEASIBILITY.md` Q2.
///
/// **Premium checkpoints are absent on purpose.** `entry_index`,
/// `accrued_scaled`, `entry_acc_q64`, and `premium_receivable` belong to
/// components 07/08. Shipping them zeroed would make the account look wired
/// when nothing writes it.
#[account]
#[derive(InitSpace)]
pub struct PermaPosition {
    pub market: Pubkey,
    pub owner: Pubkey,
    /// The Orca `Position` PDA, derived from `position_mint`.
    pub orca_position: Pubkey,
    /// The Orca position NFT mint. Re-derives `orca_position` at close.
    pub position_mint: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    /// Liquidity currently held in the Orca position.
    pub liquidity: u128,

    /// **Current** token exposure sitting inside the Orca position - observed
    /// vault deltas, not quotes.
    ///
    /// Replaces the old `deposited_a/b`, which added on every increase and was
    /// never decremented on decrease. That made it cumulative rather than
    /// current, so it could not serve as `orca_exposure` and component 03 had
    /// to pin a conservation baseline instead of asserting the real invariant.
    /// With these fields maintained on both paths, conservation is exactly
    /// checkable: `vault_s + Σ in_orca_s == Σ_users (balance_s + locked_s)`.
    pub in_orca_a: u64,
    pub in_orca_b: u64,

    /// Collateral this position locked at mint, so burn unlocks the right
    /// amount when several shorts are open at once.
    pub locked_a: u64,
    pub locked_b: u64,

    /// `leg_type::SHORT` or `leg_type::LONG`.
    ///
    /// For a LONG the Orca fields (`orca_position`, `position_mint`) are
    /// `Pubkey::default()` and `in_orca_*` / `locked_*` stay zero - a long has
    /// no Orca position and moves no tokens. `liquidity` is its size.
    pub leg_type: u8,
    /// `position_status::OPEN` or `CLOSED`.
    pub status: u8,

    // --- Premium checkpoints (component 06) ---
    // Omitted in 04/05 on purpose: shipping them zeroed would have made the
    // account look wired when nothing wrote them. This session writes them.
    /// LONG: `GlobalPremiumIndex.current_index` at open or last settle.
    pub entry_index: u128,
    /// LONG: unpaid sub-unit remainder, in `µUSDC × PREMIUM_SCALE`.
    /// Carried rather than rounded, so settle frequency cannot change the total
    /// (`07-premium-engine.md` §C).
    pub accrued_scaled: u128,
    /// SHORT: `acc_premium_per_short_q64` at open or last claim. Checkpointing
    /// at mint is what stops a late short earning for periods before it existed.
    pub entry_acc_q64: u128,
    /// SHORT: premium earned but not yet funded by any long (µUSDC).
    ///
    /// Entitlement accrues on elapsed time; cash arrives only when a long
    /// settles. This field is the gap, and it is what keeps a short that exits
    /// early from forfeiting what it earned (ADR-0002 decision 2).
    pub premium_receivable: u64,

    pub nonce: u64,
    pub bump: u8,
}

impl Market {
    /// True when `whirlpool` is the allowlisted pool for this market.
    pub fn is_allowlisted(&self, whirlpool: &Pubkey) -> bool {
        self.whirlpool == *whirlpool
    }
}
