//! PERMA - perpetual options powered by Solana liquidity.
//!
//! **Fair MVP, component 01 only.** This program currently contains the Orca
//! CLMM Adapter plus the thinnest `Market` state the adapter needs. Components
//! 02-11 (collateral, position engine, premium, settlement, risk) are not
//! implemented here.
//!
//! Prototype. Not audited. Single pool. Not production mainnet risk capital.

use anchor_lang::prelude::*;

pub mod adapter;
pub mod collateral;
pub mod errors;
pub mod factory;
pub mod position;
pub mod premium;
pub mod risk;
pub mod state;

use adapter::*;
use collateral::Side;
use errors::PermaError;
use state::{
    leg_type, position_status, premium_defaults, risk_defaults, seeds, GlobalConfig,
    GlobalPremiumIndex, Market, PermaPosition, RangePremiumState, UserCollateral,
};

declare_id!("4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt");

#[program]
pub mod perma {
    use super::*;

    /// Set the protocol admin and the single-pool allowlist.
    ///
    /// The caller becomes `admin`. There is **no setter**: the allowlist is
    /// fixed at init so an admin-key compromise cannot repoint the protocol at
    /// an attacker-controlled pool. See `factory.rs`.
    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        allowlisted_whirlpool: Pubkey,
    ) -> Result<()> {
        factory::validate_allowlist_entry(&allowlisted_whirlpool)?;

        let config = &mut ctx.accounts.global_config;
        config.admin = ctx.accounts.admin.key();
        config.allowlisted_whirlpool = allowlisted_whirlpool;
        config.bump = ctx.bumps.global_config;

        emit!(GlobalConfigInitialized {
            admin: config.admin,
            allowlisted_whirlpool,
        });
        Ok(())
    }

    /// Register the single allowlisted Orca market.
    ///
    /// Admin-only and allowlist-gated (component 02). `tick_spacing`, mints,
    /// and vaults are read from the **live** Whirlpool account - never passed
    /// in, never hardcoded.
    ///
    /// Takes no `pool_address` argument: the whirlpool arrives as an account
    /// and the `Market` PDA derives from it, so a parameter would be a
    /// redundant value that must equal `whirlpool.key()`.
    pub fn create_market(ctx: Context<CreateMarket>) -> Result<()> {
        // Who may call, and for which pool. Runs before any Whirlpool read.
        factory::authorize_create_market(
            &ctx.accounts.global_config,
            &ctx.accounts.admin.key(),
            &ctx.accounts.whirlpool.key(),
        )?;

        require_keys_eq!(
            ctx.accounts.whirlpool_program.key(),
            whirlpool_program_id(),
            PermaError::WrongWhirlpoolProgram
        );

        let pool = load_whirlpool(&ctx.accounts.whirlpool)?;

        // Fair MVP's close sequence omits collect_reward_v2, so the pool must
        // have no active reward emissions. Recorded rather than assumed.
        let has_active_rewards = pool
            .reward_infos
            .iter()
            .any(|r| r.vault != Pubkey::default());
        require!(!has_active_rewards, PermaError::InvalidAsset);

        let market = &mut ctx.accounts.market;
        market.whirlpool = ctx.accounts.whirlpool.key();
        market.whirlpools_config = pool.whirlpools_config;
        market.token_mint_a = pool.token_mint_a;
        market.token_mint_b = pool.token_mint_b;
        market.token_vault_a = pool.token_vault_a;
        market.token_vault_b = pool.token_vault_b;
        // The PERMA vaults must be real SPL token accounts for the pool's mints,
        // owned by `market_authority`. Without this the adapter would happily
        // record any account - including Orca's own vaults - as a PERMA vault.
        // Minimal check only; the full Collateral Manager is component 03.
        let auth = ctx.accounts.market_authority.key();
        let (mint_a, owner_a) = token_mint_and_owner(&ctx.accounts.vault_a)?;
        let (mint_b, owner_b) = token_mint_and_owner(&ctx.accounts.vault_b)?;
        require_keys_eq!(mint_a, pool.token_mint_a, PermaError::InvalidAsset);
        require_keys_eq!(mint_b, pool.token_mint_b, PermaError::InvalidAsset);
        require_keys_eq!(owner_a, auth, PermaError::PositionAuthorityMismatch);
        require_keys_eq!(owner_b, auth, PermaError::PositionAuthorityMismatch);

        market.vault_a = ctx.accounts.vault_a.key();
        market.vault_b = ctx.accounts.vault_b.key();
        market.tick_spacing = pool.tick_spacing; // read live
        market.has_active_rewards = has_active_rewards;
        market.is_paused = false;
        market.authority_bump = ctx.bumps.market_authority;
        market.bump = ctx.bumps.market;

        // Premium parameters (component 02). No update path exists.
        market.premium_rate = premium_defaults::PREMIUM_RATE;
        market.premium_multiplier = premium_defaults::PREMIUM_MULTIPLIER;

        // Risk parameters (component 09, ADR-0003). Demo values, not fair
        // value; a setter belongs to component 10 and must re-validate the
        // overflow bound in `risk::required_margin` before it ships.
        market.long_margin_horizon_slots = risk_defaults::LONG_MARGIN_HORIZON_SLOTS;
        market.long_margin_buffer_usdc = risk_defaults::LONG_MARGIN_BUFFER_USDC;

        emit!(MarketCreated {
            market: market.key(),
            whirlpool: market.whirlpool,
            tick_spacing: market.tick_spacing,
            admin: ctx.accounts.admin.key(),
            premium_rate: market.premium_rate,
            premium_multiplier: market.premium_multiplier,
        });
        Ok(())
    }

    /// Validate a prospective short range without touching Orca.
    ///
    /// Runs the full section C.8 preamble and reports the derived TickArrays, so
    /// a client can discover which arrays need initializing **before** it builds
    /// the mint transaction.
    pub fn validate_short_range<'info>(
        ctx: Context<'info, ValidateShortRange<'info>>,
        tick_lower: i32,
        tick_upper: i32,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        let pool = load_whirlpool(&ctx.accounts.whirlpool)?;

        validate_before_cpi(
            market,
            &ctx.accounts.whirlpool_program,
            &ctx.accounts.whirlpool,
            &pool,
            &ctx.accounts.market_authority.key(),
            &ctx.accounts.market_authority.key(),
            tick_lower,
            tick_upper,
            &ctx.accounts.tick_array_lower,
            &ctx.accounts.tick_array_upper,
            ctx.remaining_accounts,
        )?;

        emit!(RangeValidated {
            market: market.key(),
            tick_lower,
            tick_upper,
            tick_array_lower: ctx.accounts.tick_array_lower.key(),
            tick_array_upper: ctx.accounts.tick_array_upper.key(),
            current_tick: get_current_tick(&pool),
            sqrt_price_x64: get_sqrt_price_x64(&pool),
        });
        Ok(())
    }

    /// Move WSOL and/or devUSDC from the user's ATAs into the market vaults.
    ///
    /// Side `a` is the market's `token_mint_a` (WSOL), side `b` is
    /// `token_mint_b` (devUSDC). "SOL collateral" is **wrapped** SOL - raw
    /// lamports are never tracked (see `IMPL-03-FEASIBILITY.md` Q1).
    pub fn deposit_collateral(
        ctx: Context<DepositCollateral>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(amount_a > 0 || amount_b > 0, PermaError::ZeroAmount);

        let market = &ctx.accounts.market;
        // The user's source accounts must hold the market's own mints.
        check_user_ata(&ctx.accounts.user_token_a, &market.token_mint_a, &ctx.accounts.owner.key())?;
        check_user_ata(&ctx.accounts.user_token_b, &market.token_mint_b, &ctx.accounts.owner.key())?;

        let user = &mut ctx.accounts.user_collateral;
        if user.owner == Pubkey::default() {
            user.market = market.key();
            user.owner = ctx.accounts.owner.key();
            user.bump = ctx.bumps.user_collateral;
        }

        // Accounting first, then tokens: a failed transfer reverts the whole
        // transaction, so the ledger can never lead the vault.
        if amount_a > 0 {
            collateral::deposit(user, Side::A, amount_a)?;
            spl_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.user_token_a,
                &ctx.accounts.vault_a,
                &ctx.accounts.owner.to_account_info(),
                amount_a,
                None,
            )?;
        }
        if amount_b > 0 {
            collateral::deposit(user, Side::B, amount_b)?;
            spl_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.user_token_b,
                &ctx.accounts.vault_b,
                &ctx.accounts.owner.to_account_info(),
                amount_b,
                None,
            )?;
        }

        emit!(CollateralDeposited {
            market: market.key(),
            owner: user.owner,
            amount_a,
            amount_b,
            balance_a: user.balance_a,
            balance_b: user.balance_b,
        });
        Ok(())
    }

    /// Return free collateral from the market vaults to the user's ATAs.
    ///
    /// Gated by [`risk::check_withdraw_allowed`] - the single seam component 09
    /// will replace with full solvency. Locked collateral is unreachable here
    /// by construction: only free balance is debited.
    pub fn withdraw_collateral<'info>(
        ctx: Context<'info, WithdrawCollateral<'info>>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(amount_a > 0 || amount_b > 0, PermaError::ZeroAmount);

        let market = &ctx.accounts.market;
        check_user_ata(&ctx.accounts.user_token_a, &market.token_mint_a, &ctx.accounts.owner.key())?;
        check_user_ata(&ctx.accounts.user_token_b, &market.token_mint_b, &ctx.accounts.owner.key())?;

        // Validate the whole request before mutating anything. The caller
        // supplies every open long as a remaining account; with none, this is
        // exactly the component-03 check.
        let longs = risk::collect_open_longs(
            ctx.remaining_accounts,
            ctx.program_id,
            &market.key(),
            &ctx.accounts.owner.key(),
            ctx.accounts.user_collateral.open_longs,
        )?;
        let projected = projected_index_for_withdraw(
            ctx.accounts.premium_index.as_ref(),
            &market.key(),
            market.premium_rate,
            !longs.is_empty(),
            ctx.program_id,
        )?;
        risk::check_withdraw_allowed(
            &ctx.accounts.user_collateral,
            &longs,
            projected,
            market,
            amount_a,
            amount_b,
        )?;

        let market_key = market.key();
        let bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &bump]];

        let user = &mut ctx.accounts.user_collateral;
        if amount_a > 0 {
            collateral::withdraw_free(user, Side::A, amount_a)?;
            spl_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.vault_a,
                &ctx.accounts.user_token_a,
                &ctx.accounts.market_authority,
                amount_a,
                Some(signer),
            )?;
        }
        if amount_b > 0 {
            collateral::withdraw_free(user, Side::B, amount_b)?;
            spl_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.vault_b,
                &ctx.accounts.user_token_b,
                &ctx.accounts.market_authority,
                amount_b,
                Some(signer),
            )?;
        }

        emit!(CollateralWithdrawn {
            market: market_key,
            owner: user.owner,
            amount_a,
            amount_b,
            balance_a: user.balance_a,
            balance_b: user.balance_b,
        });
        Ok(())
    }

    /// Reserve free collateral against a short. Accounting only - no tokens move.
    ///
    /// User-signed in component 03 because mint does not exist yet; component
    /// 05 will compose this into `mint_options` in the same transaction as the
    /// adapter CPI.
    pub fn lock_collateral(ctx: Context<AdjustLock>, amount_a: u64, amount_b: u64) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(amount_a > 0 || amount_b > 0, PermaError::ZeroAmount);

        let user = &mut ctx.accounts.user_collateral;
        if amount_a > 0 {
            collateral::lock(user, Side::A, amount_a)?;
        }
        if amount_b > 0 {
            collateral::lock(user, Side::B, amount_b)?;
        }

        emit!(CollateralLocked {
            market: ctx.accounts.market.key(),
            owner: user.owner,
            amount_a,
            amount_b,
            locked_a: user.locked_a,
            locked_b: user.locked_b,
        });
        Ok(())
    }

    /// Release reserved collateral back to free.
    ///
    /// Refuses while `open_positions > 0`. That counter is always zero until
    /// component 05 increments it on mint, so this is inert today and prevents
    /// unlocking collateral behind a live short the moment mint ships.
    pub fn unlock_collateral(ctx: Context<AdjustLock>, amount_a: u64, amount_b: u64) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(amount_a > 0 || amount_b > 0, PermaError::ZeroAmount);

        let user = &mut ctx.accounts.user_collateral;
        if amount_a > 0 {
            collateral::unlock(user, Side::A, amount_a)?;
        }
        if amount_b > 0 {
            collateral::unlock(user, Side::B, amount_b)?;
        }

        emit!(CollateralUnlocked {
            market: ctx.accounts.market.key(),
            owner: user.owner,
            amount_a,
            amount_b,
            locked_a: user.locked_a,
            locked_b: user.locked_b,
        });
        Ok(())
    }

    /// **Open a short.** The product path: lock collateral, create the Orca
    /// position, and add real Whirlpool liquidity - in one atomic instruction.
    ///
    /// Everything below `adapter_*` is harness-level; this is what a user
    /// actually calls. Doing it in one transaction means a failure cannot leave
    /// an orphaned Orca position holding rent with no PERMA position behind it.
    ///
    /// `token_max_a/b` are slippage caps supplied by the client (PERMA does not
    /// quote Whirlpool math on-chain). Free balance must cover them, but what
    /// gets **locked is the observed spend**, not the cap - see `position.rs`.
    #[allow(clippy::too_many_arguments)]
    pub fn mint_position<'info>(
        ctx: Context<'info, MintPosition<'info>>,
        leg: u8,
        tick_lower: i32,
        tick_upper: i32,
        liquidity: u128,
        token_max_a: u64,
        token_max_b: u64,
        nonce: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(
            leg == leg_type::SHORT || leg == leg_type::LONG,
            PermaError::InvalidLegType
        );
        require!(liquidity > 0, PermaError::ZeroAmount);

        // --- Shared prefix: advance the clock, then attribute the elapsed
        // period at the weights that were in force during it. MUST precede any
        // change to total_short/total_long (08-burn-settle.md invariant 5).
        {
            let now = Clock::get()?.slot;
            let market_rate = ctx.accounts.market.premium_rate;
            // Record the canonical bump on first touch; `burn_position`
            // re-derives the PDA with `bump = premium_index.bump`, so leaving
            // it zero would make every burn fail ConstraintSeeds.
            if ctx.accounts.premium_index.bump == 0 {
                ctx.accounts.premium_index.bump = ctx.bumps.premium_index;
                ctx.accounts.premium_index.last_update_slot = now;
            }
            premium::update_index(&mut ctx.accounts.premium_index, market_rate, now)?;

            let range = &mut ctx.accounts.range_state;
            if range.market == Pubkey::default() {
                range.market = ctx.accounts.market.key();
                range.tick_lower = tick_lower;
                range.tick_upper = tick_upper;
                range.bump = ctx.bumps.range_state;
            }
            require!(
                range.tick_lower == tick_lower && range.tick_upper == tick_upper,
                PermaError::InvalidRange
            );
            premium::poke_range(&ctx.accounts.premium_index, &ctx.accounts.market, range)?;
        }

        if leg == leg_type::LONG {
            return mint_long_inner(ctx, tick_lower, tick_upper, liquidity, nonce);
        }

        // SHORT: every Orca account must be present; the `address =` guards that
        // became Option are re-asserted in `resolve`.
        let m = MintShortAccounts::resolve(&ctx)?;

        // The escrow is born with the range, paid for by the first short in it,
        // so no settle path ever has to handle a missing vault and the
        // invariant `range_vault.amount == premium_pool + dust` holds from t=0.
        ensure_range_vault(
            &ctx.accounts.range_vault.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            &ctx.accounts.market.key(),
            &ctx.accounts.market_authority.key(),
            m.token_mint_b,
            m.token_program,
            &ctx.accounts.system_program.to_account_info(),
            &ctx.accounts.rent,
            tick_lower,
            tick_upper,
            ctx.program_id,
        )?;

        let market = &ctx.accounts.market;
        let pool = load_whirlpool(m.whirlpool)?;

        validate_before_cpi(
            market,
            m.whirlpool_program,
            m.whirlpool,
            &pool,
            &ctx.accounts.market_authority.key(),
            &ctx.accounts.market_authority.key(),
            tick_lower,
            tick_upper,
            m.tick_array_lower,
            m.tick_array_upper,
            ctx.remaining_accounts,
        )?;

        // A short's collateral is what it locks: free balance must cover the
        // caps. The long-side margin model (component 09) does not apply here.
        {
            let user = &ctx.accounts.user_collateral;
            require!(
                user.balance_a >= token_max_a && user.balance_b >= token_max_b,
                PermaError::InsufficientFunds
            );
        }

        // 1. Create the Orca position, owned by the market_authority PDA.
        let (expected_position, position_bump) = Pubkey::find_program_address(
            &[b"position", m.position_mint.key().as_ref()],
            &adapter::whirlpool_program_id(),
        );
        require_keys_eq!(
            m.orca_position.key(),
            expected_position,
            PermaError::PositionAuthorityMismatch
        );

        let rent_info = ctx.accounts.rent.to_account_info();
        open_position_for_short(
            &OpenPositionAccounts {
                whirlpool_program: m.whirlpool_program,
                funder: &ctx.accounts.owner,
                owner: &ctx.accounts.market_authority,
                position: m.orca_position,
                position_mint: m.position_mint,
                position_token_account: m.position_token_account,
                whirlpool: m.whirlpool,
                token_program: m.token_program,
                system_program: &ctx.accounts.system_program.to_account_info(),
                rent: &rent_info,
                associated_token_program: m.associated_token_program,
            },
            position_bump,
            tick_lower,
            tick_upper,
        )?;

        // 2. Add liquidity, measuring what it actually cost.
        let before_a = token_amount(m.vault_a)?;
        let before_b = token_amount(m.vault_b)?;

        let market_key = market.key();
        let auth_bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump]];

        add_liquidity_for_short(
            &mint_modify_accounts(&m),
            liquidity,
            token_max_a,
            token_max_b,
            signer,
        )?;

        let spent_a = before_a.saturating_sub(token_amount(m.vault_a)?);
        let spent_b = before_b.saturating_sub(token_amount(m.vault_b)?);
        require!(
            spent_a <= token_max_a && spent_b <= token_max_b,
            PermaError::SlippageExceeded
        );

        // 3. Books: lock the observed spend, track exposure, count the position.
        let orca_position_key = m.orca_position.key();
        let position_mint_key = m.position_mint.key();
        let pos = &mut ctx.accounts.perma_position;
        pos.market = market_key;
        pos.owner = ctx.accounts.owner.key();
        pos.orca_position = orca_position_key;
        pos.position_mint = position_mint_key;
        pos.tick_lower = tick_lower;
        pos.tick_upper = tick_upper;
        pos.nonce = nonce;
        pos.bump = ctx.bumps.perma_position;

        position::open_short(
            pos,
            &mut ctx.accounts.user_collateral,
            &position::MintOutcome { liquidity, spent_a, spent_b },
        )?;

        // Weights change only AFTER the poke in the shared prefix. Checkpoint
        // this short at the current accumulator so it earns nothing for periods
        // before it existed.
        let range = &mut ctx.accounts.range_state;
        pos.entry_acc_q64 = range.acc_premium_per_short_q64;
        range.total_short_liquidity = range
            .total_short_liquidity
            .checked_add(liquidity)
            .ok_or(PermaError::MathOverflow)?;

        emit!(ShortMinted {
            market: market_key,
            owner: ctx.accounts.owner.key(),
            perma_position: pos.key(),
            orca_position: pos.orca_position,
            tick_lower,
            tick_upper,
            liquidity,
            locked_a: spent_a,
            locked_b: spent_b,
            open_positions: ctx.accounts.user_collateral.open_positions,
        });
        Ok(())
    }

    /// **Settle premium in cash.** The instruction component 08 exists for.
    ///
    /// Every path here moves USDC *and* updates the books in the same function
    /// body, so no caller can ever clear a liability without the matching
    /// transfer - the single failure mode this component was written to remove
    /// (ADR-0002 addendum; `08-burn-settle.md` §C-D).
    ///
    /// **LONG (§C) - permissionless.** Any signer may crank any open long:
    /// premium is a pure function of elapsed slots and `payable_from` floors
    /// with carry, so cranking often and cranking once cost the long exactly
    /// the same. That is what makes "anybody may call this" safe.
    ///
    /// **SHORT (§D) - owner only.** It credits the owner's free balance, so a
    /// stranger has no business calling it. A short whose claim outruns the
    /// pool is paid what the pool holds and carries the rest on
    /// `premium_receivable`; when the balance finally clears, a
    /// `PendingPremium` position closes and refunds its rent.
    ///
    /// **P&L is not settled here.** Component 09 owns valuation; this moves
    /// premium and nothing else.
    pub fn settle_premium(mut ctx: Context<SettlePremium>) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);

        let market_key = ctx.accounts.market.key();
        let tick_lower = ctx.accounts.perma_position.tick_lower;
        let tick_upper = ctx.accounts.perma_position.tick_upper;

        // `range_state` is seed-checked against the position's ticks by Anchor;
        // the vault is a bare `UncheckedAccount`, so derive it here.
        let (expected_vault, _) = Pubkey::find_program_address(
            &[
                seeds::RANGE_VAULT,
                market_key.as_ref(),
                &tick_lower.to_le_bytes(),
                &tick_upper.to_le_bytes(),
            ],
            ctx.program_id,
        );
        require_keys_eq!(
            ctx.accounts.range_vault.key(),
            expected_vault,
            PermaError::RangeStateMismatch
        );

        // Advance the clock, then attribute the elapsed period at the weights
        // in force during it - before anything reads an entitlement.
        let now = Clock::get()?.slot;
        let rate = ctx.accounts.market.premium_rate;
        premium::update_index(&mut ctx.accounts.premium_index, rate, now)?;
        premium::poke_range(
            &ctx.accounts.premium_index,
            &ctx.accounts.market,
            &mut ctx.accounts.range_state,
        )?;

        match ctx.accounts.perma_position.leg_type {
            leg_type::LONG => settle_long_cash(&mut ctx),
            leg_type::SHORT => settle_short_cash(&mut ctx),
            _ => err!(PermaError::InvalidLegType),
        }
    }

    /// **Close a position.** Branches on leg; see the per-leg docs below.
    ///
    /// **Close a short.** Runs the full 3-step Orca close, releases the
    /// collateral this position locked, and credits whatever Orca returned.
    ///
    /// `returned` differs from `locked` under impermanent loss or accrued fees;
    /// the difference is realized PnL absorbed into free balance. See
    /// `position.rs` for why any other rule breaks conservation.
    ///
    /// **Forward dependency:** when component 08 lands, this must call
    /// `settle_premium` *before* the close sequence (`08-burn-settle.md` §E).
    pub fn burn_position<'info>(
        mut ctx: Context<'info, BurnPosition<'info>>,
        token_min_a: u64,
        token_min_b: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.market.is_paused, PermaError::MarketPaused);
        require!(
            ctx.accounts.perma_position.status == position_status::OPEN,
            PermaError::PositionAlreadyClosed
        );

        // Shared prefix: same ordering rule as mint - poke before any weight
        // change, so the elapsed period is attributed at the weights that were
        // in force during it.
        {
            let now = Clock::get()?.slot;
            let rate = ctx.accounts.market.premium_rate;
            premium::update_index(&mut ctx.accounts.premium_index, rate, now)?;
            premium::poke_range(
                &ctx.accounts.premium_index,
                &ctx.accounts.market,
                &mut ctx.accounts.range_state,
            )?;
        }

        if ctx.accounts.perma_position.leg_type == leg_type::LONG {
            return burn_long_inner(ctx);
        }

        // Claim premium **while this short is still inside
        // `total_short_liquidity`** (08-burn-settle.md §E.2). Doing it after
        // the decrement below would compute the share against a denominator
        // this position is no longer part of - an ordering bug that silently
        // overpays whoever is left. Runs before the vault snapshots below, so
        // the USDC it credits is not mistaken for an Orca return.
        let (claimed, still_owed) = claim_short_premium_cash(&mut ctx)?;

        // SHORT: every Orca account must be present, and the ones that carried
        // `address =` constraints before they became Option are re-asserted
        // here so the checks are not silently lost.
        let b = BurnShortAccounts::resolve(&ctx)?;
        let market = &ctx.accounts.market;
        let pool = load_whirlpool(b.whirlpool)?;
        let (tick_lower, tick_upper) = (
            ctx.accounts.perma_position.tick_lower,
            ctx.accounts.perma_position.tick_upper,
        );

        validate_before_cpi(
            market,
            b.whirlpool_program,
            b.whirlpool,
            &pool,
            &ctx.accounts.market_authority.key(),
            &ctx.accounts.market_authority.key(),
            tick_lower,
            tick_upper,
            b.tick_array_lower,
            b.tick_array_upper,
            ctx.remaining_accounts,
        )?;

        let before_a = token_amount(b.vault_a)?;
        let before_b = token_amount(b.vault_b)?;

        let market_key = market.key();
        let auth_bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump]];

        // 3-step close: decrease -> collect -> close. Never insert
        // `update_fees_and_rewards` between the first two (ADR-0001).
        let liquidity = ctx.accounts.perma_position.liquidity;
        remove_liquidity_for_short(
            &burn_modify_accounts(&b),
            &burn_collect_accounts(&b),
            liquidity,
            token_min_a,
            token_min_b,
            true,
            signer,
        )?;
        close_position_for_short(
            &ClosePositionAccounts {
                whirlpool_program: b.whirlpool_program,
                position_authority: &ctx.accounts.market_authority,
                receiver: &ctx.accounts.owner,
                position: b.orca_position,
                position_mint: b.position_mint,
                position_token_account: b.position_token_account,
                token_program: b.token_program,
            },
            signer,
        )?;

        let returned_a = token_amount(b.vault_a)?.saturating_sub(before_a);
        let returned_b = token_amount(b.vault_b)?.saturating_sub(before_b);

        // Weight change, strictly after the poke. A short may not withdraw
        // liquidity that longs are currently relying on.
        {
            let liq = ctx.accounts.perma_position.liquidity;
            let range = &mut ctx.accounts.range_state;
            let remaining = range
                .total_short_liquidity
                .checked_sub(liq)
                .ok_or(PermaError::MathOverflow)?;
            require!(
                remaining >= range.total_long_liquidity,
                PermaError::InventoryInvariantViolated
            );
            range.total_short_liquidity = remaining;
        }

        let pos = &mut ctx.accounts.perma_position;
        let (locked_a, locked_b) = (pos.locked_a, pos.locked_b);
        position::close_short(
            pos,
            &mut ctx.accounts.user_collateral,
            &position::BurnOutcome { returned_a, returned_b },
        )?;

        let status = pos.status;
        emit!(ShortBurned {
            market: market_key,
            owner: ctx.accounts.owner.key(),
            perma_position: pos.key(),
            liquidity,
            unlocked_a: locked_a,
            unlocked_b: locked_b,
            returned_a,
            returned_b,
            premium_claimed: claimed,
            premium_receivable: still_owed,
            status,
            open_positions: ctx.accounts.user_collateral.open_positions,
        });

        // `close = owner` is deliberately absent from `BurnPosition`: a
        // `PendingPremium` short keeps its account (and its rent) until
        // `settle_premium` clears the claim.
        if status == position_status::CLOSED {
            ctx.accounts
                .perma_position
                .close(ctx.accounts.owner.to_account_info())?;
        }
        Ok(())
    }

    /// Create the Orca position for a new short and register it with PERMA.
    ///
    /// Runs as a **prior transaction** to `adapter_add_liquidity` - bundling
    /// both plus a TickArray init left only ~80 bytes of transaction headroom.
    ///
    /// The position NFT lands in an ATA owned by `market_authority`, so every
    /// later `position_authority` check passes and no user key can ever move
    /// the position (ADR-0001).
    pub fn adapter_open_position(
        ctx: Context<AdapterOpenPosition>,
        tick_lower: i32,
        tick_upper: i32,
        nonce: u64,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(!market.is_paused, PermaError::WhirlpoolNotAllowlisted);
        require_keys_eq!(
            ctx.accounts.whirlpool_program.key(),
            adapter::whirlpool_program_id(),
            PermaError::WrongWhirlpoolProgram
        );
        require!(
            market.is_allowlisted(&ctx.accounts.whirlpool.key()),
            PermaError::WhirlpoolNotAllowlisted
        );

        // Tick rules, against the spacing recorded from the live pool.
        let spacing = market.tick_spacing;
        require!(tick_lower < tick_upper, PermaError::InvalidRange);
        require!(
            adapter::is_usable_tick(tick_lower, spacing)
                && adapter::is_usable_tick(tick_upper, spacing),
            PermaError::TickNotAlignedToSpacing
        );

        // Orca derives the position PDA from the position mint. Derive it here
        // too, both to supply the bump and to reject a mismatched account
        // before the CPI rather than after.
        let (expected_position, position_bump) = Pubkey::find_program_address(
            &[b"position", ctx.accounts.position_mint.key().as_ref()],
            &adapter::whirlpool_program_id(),
        );
        require_keys_eq!(
            ctx.accounts.orca_position.key(),
            expected_position,
            PermaError::PositionAuthorityMismatch
        );

        let rent_info = ctx.accounts.rent.to_account_info();
        open_position_for_short(
            &OpenPositionAccounts {
                whirlpool_program: &ctx.accounts.whirlpool_program,
                funder: &ctx.accounts.owner,
                owner: &ctx.accounts.market_authority,
                position: &ctx.accounts.orca_position,
                position_mint: &ctx.accounts.position_mint,
                position_token_account: &ctx.accounts.position_token_account,
                whirlpool: &ctx.accounts.whirlpool,
                token_program: &ctx.accounts.token_program,
                system_program: &ctx.accounts.system_program.to_account_info(),
                rent: &rent_info,
                associated_token_program: &ctx.accounts.associated_token_program,
            },
            position_bump,
            tick_lower,
            tick_upper,
        )?;

        let pos = &mut ctx.accounts.perma_position;
        pos.market = market.key();
        pos.owner = ctx.accounts.owner.key();
        pos.orca_position = ctx.accounts.orca_position.key();
        pos.position_mint = ctx.accounts.position_mint.key();
        pos.tick_lower = tick_lower;
        pos.tick_upper = tick_upper;
        pos.liquidity = 0;
        pos.in_orca_a = 0;
        pos.in_orca_b = 0;
        pos.locked_a = 0;
        pos.locked_b = 0;
        pos.leg_type = leg_type::SHORT;
        pos.status = position_status::OPEN;
        pos.nonce = nonce;
        pos.bump = ctx.bumps.perma_position;

        emit!(PositionOpened {
            market: market.key(),
            perma_position: pos.key(),
            orca_position: pos.orca_position,
            position_mint: pos.position_mint,
            tick_lower,
            tick_upper,
        });
        Ok(())
    }

    /// Burn the Orca position NFT and reclaim its rent.
    ///
    /// **Step 3 of the full close.** Callers run
    /// `adapter_remove_liquidity(close_after = true)` first, which performs
    /// `decrease_liquidity_v2` then `collect_fees_v2`. Invoking this while
    /// liquidity or fees remain yields Orca `ClosePositionNotEmpty` (`0x1775`) -
    /// that propagation is a deliberate regression guard, not a bug.
    pub fn adapter_close_position(ctx: Context<AdapterClosePosition>) -> Result<()> {
        let market = &ctx.accounts.market;
        require_keys_eq!(
            ctx.accounts.whirlpool_program.key(),
            adapter::whirlpool_program_id(),
            PermaError::WrongWhirlpoolProgram
        );
        require_keys_eq!(
            ctx.accounts.orca_position.key(),
            ctx.accounts.perma_position.orca_position,
            PermaError::PositionAuthorityMismatch
        );

        let market_key = market.key();
        let bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &bump]];

        close_position_for_short(
            &ClosePositionAccounts {
                whirlpool_program: &ctx.accounts.whirlpool_program,
                position_authority: &ctx.accounts.market_authority,
                receiver: &ctx.accounts.owner,
                position: &ctx.accounts.orca_position,
                position_mint: &ctx.accounts.position_mint,
                position_token_account: &ctx.accounts.position_token_account,
                token_program: &ctx.accounts.token_program,
            },
            signer,
        )?;

        emit!(PositionClosed {
            market: market_key,
            perma_position: ctx.accounts.perma_position.key(),
            orca_position: ctx.accounts.orca_position.key(),
        });
        Ok(())
    }

    /// Add Orca liquidity for a short position.
    ///
    /// Assumes the Orca position already exists and both TickArrays are
    /// initialized - `initialize_tick_array` and `open_position` run as prior
    /// instructions, never as a CPI from this path (spec section C.5).
    ///
    /// Token amounts recorded are **observed vault deltas**, not the caller's quote.
    pub fn adapter_add_liquidity<'info>(
        ctx: Context<'info, AdapterAddLiquidity<'info>>,
        tick_lower: i32,
        tick_upper: i32,
        liquidity_amount: u128,
        token_max_a: u64,
        token_max_b: u64,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(!market.is_paused, PermaError::WhirlpoolNotAllowlisted);
        reject_harness_if_longs(
            &ctx.accounts.range_state,
            &market.key(),
            tick_lower,
            tick_upper,
            ctx.program_id,
        )?;
        let pool = load_whirlpool(&ctx.accounts.whirlpool)?;

        validate_before_cpi(
            market,
            &ctx.accounts.whirlpool_program,
            &ctx.accounts.whirlpool,
            &pool,
            &ctx.accounts.market_authority.key(),
            &ctx.accounts.market_authority.key(),
            tick_lower,
            tick_upper,
            &ctx.accounts.tick_array_lower,
            &ctx.accounts.tick_array_upper,
            ctx.remaining_accounts,
        )?;

        // Snapshot BEFORE the CPI so the recorded spend is measured, not quoted.
        let before_a = token_amount(&ctx.accounts.vault_a)?;
        let before_b = token_amount(&ctx.accounts.vault_b)?;

        let market_key = market.key();
        let bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &bump]];

        add_liquidity_for_short(
            &modify_accounts(&ctx),
            liquidity_amount,
            token_max_a,
            token_max_b,
            signer,
        )?;

        let spent_a = before_a.saturating_sub(token_amount(&ctx.accounts.vault_a)?);
        let spent_b = before_b.saturating_sub(token_amount(&ctx.accounts.vault_b)?);
        require!(
            spent_a <= token_max_a && spent_b <= token_max_b,
            PermaError::SlippageExceeded
        );

        let pos = &mut ctx.accounts.perma_position;
        pos.liquidity = pos
            .liquidity
            .checked_add(liquidity_amount)
            .ok_or(PermaError::MathOverflow)?;
        // CURRENT exposure, not cumulative deposits. The old `deposited_*`
        // fields were never decremented on remove, so they over-counted after
        // any partial close and could not serve as `orca_exposure`.
        pos.in_orca_a = pos
            .in_orca_a
            .checked_add(spent_a)
            .ok_or(PermaError::MathOverflow)?;
        pos.in_orca_b = pos
            .in_orca_b
            .checked_add(spent_b)
            .ok_or(PermaError::MathOverflow)?;

        emit!(LiquidityAdded {
            market: market_key,
            perma_position: pos.key(),
            orca_position: ctx.accounts.orca_position.key(),
            tick_lower,
            tick_upper,
            liquidity: liquidity_amount,
            amount_a: spent_a,
            amount_b: spent_b,
        });
        Ok(())
    }

    /// Remove Orca liquidity for a short.
    ///
    /// `close_after = true` runs `decrease_liquidity_v2` -> `collect_fees_v2`.
    /// The caller issues `close_position` as the final instruction. Partial
    /// removes pass `false` and skip the fee collection.
    pub fn adapter_remove_liquidity<'info>(
        ctx: Context<'info, AdapterRemoveLiquidity<'info>>,
        tick_lower: i32,
        tick_upper: i32,
        liquidity_amount: u128,
        token_min_a: u64,
        token_min_b: u64,
        close_after: bool,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        reject_harness_if_longs(
            &ctx.accounts.range_state,
            &market.key(),
            tick_lower,
            tick_upper,
            ctx.program_id,
        )?;
        let pool = load_whirlpool(&ctx.accounts.whirlpool)?;

        validate_before_cpi(
            market,
            &ctx.accounts.whirlpool_program,
            &ctx.accounts.whirlpool,
            &pool,
            &ctx.accounts.market_authority.key(),
            &ctx.accounts.market_authority.key(),
            tick_lower,
            tick_upper,
            &ctx.accounts.tick_array_lower,
            &ctx.accounts.tick_array_upper,
            ctx.remaining_accounts,
        )?;

        require!(
            liquidity_amount <= ctx.accounts.perma_position.liquidity,
            PermaError::InvalidRange
        );

        let before_a = token_amount(&ctx.accounts.vault_a)?;
        let before_b = token_amount(&ctx.accounts.vault_b)?;

        let market_key = market.key();
        let bump = [market.authority_bump];
        let signer: &[&[&[u8]]] = &[&[seeds::MARKET_AUTHORITY, market_key.as_ref(), &bump]];

        remove_liquidity_for_short(
            &modify_accounts_remove(&ctx),
            &collect_accounts(&ctx),
            liquidity_amount,
            token_min_a,
            token_min_b,
            close_after,
            signer,
        )?;

        let got_a = token_amount(&ctx.accounts.vault_a)?.saturating_sub(before_a);
        let got_b = token_amount(&ctx.accounts.vault_b)?.saturating_sub(before_b);

        // Keep `in_orca_*` current so conservation stays checkable.
        let pos = &mut ctx.accounts.perma_position;
        position::reduce_exposure(pos, liquidity_amount, got_a, got_b)?;

        emit!(LiquidityRemoved {
            market: market_key,
            perma_position: pos.key(),
            orca_position: ctx.accounts.orca_position.key(),
            liquidity: liquidity_amount,
            amount_a: got_a,
            amount_b: got_b,
            closed: close_after,
        });
        Ok(())
    }
}

// --- helpers -------------------------------------------------------------

/// Read an SPL token account's `amount` (offset 64, u64 LE) without pulling
/// anchor-spl in. Keeps the dependency graph minimal for component 01.
fn token_amount(info: &AccountInfo) -> Result<u64> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= 72, PermaError::InvalidAsset);
    Ok(u64::from_le_bytes(
        data[64..72].try_into().map_err(|_| PermaError::InvalidAsset)?,
    ))
}

/// Assert an account is an initialized SPL token account for `mint`, owned by
/// `owner`. Guards deposit/withdraw against wrong-mint or someone else's ATA.
fn check_user_ata(info: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> Result<()> {
    let (actual_mint, actual_owner) = token_mint_and_owner(info)?;
    require_keys_eq!(actual_mint, *mint, PermaError::InvalidAsset);
    require_keys_eq!(actual_owner, *owner, PermaError::InvalidAsset);
    Ok(())
}

/// Hand-built SPL `Transfer` (instruction tag `3`, then the `u64` amount).
///
/// Built by hand rather than via `anchor-spl` to keep the dependency graph as
/// ADR-0001 requires - adding `anchor-spl` risks pulling a second `solana-*`
/// family alongside `orca_whirlpools_client`.
///
/// `signer_seeds` is `Some` when the source is a PDA-owned vault, `None` when
/// the user signs for their own ATA.
fn spl_transfer<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let mut data = Vec::with_capacity(9);
    data.push(3u8); // SPL Token instruction: Transfer
    data.extend_from_slice(&amount.to_le_bytes());

    // The authority is ALWAYS `is_signer = true`. `invoke` vs `invoke_signed`
    // only changes who supplies that signature - the user's own key, or the
    // runtime deriving it from the PDA seeds. Marking it false for the PDA case
    // makes SPL Token reject the transfer with MissingRequiredSignature.
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: token_program.key(),
        accounts: vec![
            AccountMeta::new(from.key(), false),
            AccountMeta::new(to.key(), false),
            AccountMeta::new_readonly(authority.key(), true),
        ],
        data,
    };
    let infos = [from.clone(), to.clone(), authority.clone(), token_program.clone()];

    match signer_seeds {
        Some(seeds) => anchor_lang::solana_program::program::invoke_signed(&ix, &infos, seeds)?,
        None => anchor_lang::solana_program::program::invoke(&ix, &infos)?,
    }
    Ok(())
}

/// The LONG side of `settle_premium`: a long pays what it has accrued.
///
/// The debit, the transfer and the liability clear are three statements in one
/// function on purpose. Splitting them across instructions is how a protocol
/// ends up clearing a debt it never collected.
fn settle_long_cash(ctx: &mut Context<SettlePremium>) -> Result<()> {
    require!(
        ctx.accounts.perma_position.status == position_status::OPEN,
        PermaError::PositionAlreadyClosed
    );

    premium::accrue_long(
        &ctx.accounts.premium_index,
        &ctx.accounts.market,
        &mut ctx.accounts.perma_position,
    )?;
    // Floor-with-carry. NOT touched by this component: rounding up per settle
    // would let a permissionless cranker inflate a long's cost by calling often
    // (ADR-0002), which is exactly what makes §C's "anyone may crank" safe.
    let payable = premium::payable_from(&mut ctx.accounts.perma_position);
    require!(payable > 0, PermaError::NothingToSettle);

    // Fails `InsufficientCollateralForLoss` rather than raiding `locked_b`,
    // which backs somebody else's Orca liquidity.
    collateral::debit_usdc(&mut ctx.accounts.user_collateral, payable)?;

    let market_key = ctx.accounts.market.key();
    let auth_bump = [ctx.accounts.market.authority_bump];
    let signer: &[&[u8]] = &[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump];
    spl_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.vault_b.to_account_info(),
        &ctx.accounts.range_vault.to_account_info(),
        &ctx.accounts.market_authority.to_account_info(),
        payable,
        Some(&[signer]),
    )?;

    premium::apply_long_payment(&mut ctx.accounts.range_state, payable)?;

    // Clear the liability - paired with the transfer above and never larger
    // than it, so every unit forgiven is a unit that actually moved. Non-zero
    // only for longs burned before this component existed, when `close_long`
    // recorded the obligation without cash; those debts become payable instead
    // of stranded. Nothing in 08 ever increases this field.
    let user = &mut ctx.accounts.user_collateral;
    let cleared = user.premium_owed_usdc.min(payable);
    user.premium_owed_usdc -= cleared;

    emit!(PremiumSettled {
        market: market_key,
        owner: ctx.accounts.owner.key(),
        perma_position: ctx.accounts.perma_position.key(),
        leg_type: leg_type::LONG,
        amount: payable,
        still_owed: 0,
        premium_pool: ctx.accounts.range_state.premium_pool,
        premium_owed_usdc: ctx.accounts.user_collateral.premium_owed_usdc,
    });
    Ok(())
}

/// The SHORT side of `settle_premium`: a short collects what longs have paid.
///
/// Owner-only, because it credits the owner's free balance. Capped by
/// `premium_pool` - an entitlement is not cash until some long has funded it,
/// and the shortfall is carried rather than forfeited.
fn settle_short_cash(ctx: &mut Context<SettlePremium>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.cranker.key(),
        ctx.accounts.perma_position.owner,
        PermaError::Unauthorized
    );

    let (paid, still_owed) = premium::claim_short_amount(
        &ctx.accounts.perma_position,
        &ctx.accounts.range_state,
    )?;
    require!(paid > 0, PermaError::NothingToSettle);

    let market_key = ctx.accounts.market.key();
    let auth_bump = [ctx.accounts.market.authority_bump];
    let signer: &[&[u8]] = &[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump];
    spl_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.range_vault.to_account_info(),
        &ctx.accounts.vault_b.to_account_info(),
        &ctx.accounts.market_authority.to_account_info(),
        paid,
        Some(&[signer]),
    )?;

    collateral::credit_usdc(&mut ctx.accounts.user_collateral, paid)?;
    premium::apply_short_claim(
        &mut ctx.accounts.perma_position,
        &mut ctx.accounts.range_state,
        paid,
        still_owed,
    )?;

    emit!(PremiumSettled {
        market: market_key,
        owner: ctx.accounts.owner.key(),
        perma_position: ctx.accounts.perma_position.key(),
        leg_type: leg_type::SHORT,
        amount: paid,
        still_owed,
        premium_pool: ctx.accounts.range_state.premium_pool,
        premium_owed_usdc: ctx.accounts.user_collateral.premium_owed_usdc,
    });

    // A short that burned into `PendingPremium` only kept its account alive to
    // hold the unfunded claim. Now that it is paid, release the rent.
    if ctx.accounts.perma_position.status == position_status::PENDING_PREMIUM
        && ctx.accounts.perma_position.premium_receivable == 0
    {
        ctx.accounts.perma_position.status = position_status::CLOSED;
        ctx.accounts
            .perma_position
            .close(ctx.accounts.owner.to_account_info())?;
    }
    Ok(())
}

/// Project the premium index for a withdraw without writing it.
///
/// `withdraw_collateral` does not run the poke prefix, so the stored index can
/// lag; `premium::projected_index` closes that gap exactly. The account is an
/// `UncheckedAccount` because it may not exist yet on a fresh ledger - which is
/// fine precisely when `needed == false`, since no long can exist before the
/// first mint created the index.
fn projected_index_for_withdraw<'info>(
    info: &'info AccountInfo<'info>,
    market: &Pubkey,
    premium_rate: u64,
    needed: bool,
    program_id: &Pubkey,
) -> Result<u128> {
    let (expected, _) =
        Pubkey::find_program_address(&[seeds::PREMIUM_INDEX, market.as_ref()], program_id);
    require_keys_eq!(info.key(), expected, PermaError::InvalidAsset);
    if !needed {
        return Ok(0);
    }
    let index = Account::<GlobalPremiumIndex>::try_from(info)
        .map_err(|_| error!(PermaError::InvalidAsset))?;
    premium::projected_index(&index, premium_rate, Clock::get()?.slot)
}

/// Create the per-range premium escrow if it does not exist yet.
///
/// Hand-built for the same reason as [`spl_transfer`]: `anchor-spl` is absent
/// by ADR-0001. `system_program::create_account` signed by the vault's own PDA
/// seeds, then SPL `InitializeAccount3` (tag `18`, owner inline - no rent
/// sysvar account, unlike tag `1`).
///
/// Called on the first SHORT mint in a range, so `range_vault.amount ==
/// premium_pool + dust` holds from the range's first moment. Idempotent: a
/// vault that already exists is only re-validated.
#[allow(clippy::too_many_arguments)]
fn ensure_range_vault<'info>(
    range_vault: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    market: &Pubkey,
    market_authority: &Pubkey,
    token_mint_b: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    rent: &Rent,
    tick_lower: i32,
    tick_upper: i32,
    program_id: &Pubkey,
) -> Result<()> {
    let lower = tick_lower.to_le_bytes();
    let upper = tick_upper.to_le_bytes();
    let seeds: [&[u8]; 4] = [seeds::RANGE_VAULT, market.as_ref(), &lower, &upper];
    let (expected, bump) = Pubkey::find_program_address(&seeds, program_id);
    require_keys_eq!(range_vault.key(), expected, PermaError::RangeStateMismatch);

    if range_vault.data_len() == 0 {
        const TOKEN_ACCOUNT_LEN: u64 = 165;
        let bump_seed = [bump];
        let signer: &[&[u8]] = &[seeds::RANGE_VAULT, market.as_ref(), &lower, &upper, &bump_seed];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::create_account(
                &payer.key(),
                &range_vault.key(),
                rent.minimum_balance(TOKEN_ACCOUNT_LEN as usize),
                TOKEN_ACCOUNT_LEN,
                &token_program.key(),
            ),
            &[payer.clone(), range_vault.clone(), system_program.clone()],
            &[signer],
        )?;

        let mut data = Vec::with_capacity(33);
        data.push(18u8); // SPL Token: InitializeAccount3
        data.extend_from_slice(market_authority.as_ref());
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::instruction::Instruction {
                program_id: token_program.key(),
                accounts: vec![
                    AccountMeta::new(range_vault.key(), false),
                    AccountMeta::new_readonly(token_mint_b.key(), false),
                ],
                data,
            },
            &[range_vault.clone(), token_mint_b.clone(), token_program.clone()],
        )?;
    }

    // Holds premium in USDC on behalf of the market, whether just created or
    // found - a vault with the wrong mint or owner would silently misroute
    // every settle.
    check_user_ata(range_vault, &token_mint_b.key(), market_authority)?;
    Ok(())
}

/// Read `(mint, owner)` from an SPL token account: mint at 0..32, owner at
/// 32..64, `state` at 108 (1 = Initialized). Same rationale as [`token_amount`].
fn token_mint_and_owner(info: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= 165, PermaError::InvalidAsset);
    require!(data[108] == 1, PermaError::InvalidAsset); // Initialized
    let mint = Pubkey::try_from(&data[0..32]).map_err(|_| PermaError::InvalidAsset)?;
    let owner = Pubkey::try_from(&data[32..64]).map_err(|_| PermaError::InvalidAsset)?;
    Ok((mint, owner))
}


/// The Orca-side accounts a SHORT mint needs.
///
/// `MintPosition` declares them `Option` so a LONG mint stays small (component
/// 09). Resolving them here keeps the unwrapping in one place and re-asserts
/// the `address` constraints, exactly as `BurnShortAccounts` does.
struct MintShortAccounts<'a, 'info> {
    whirlpool: &'a AccountInfo<'info>,
    orca_position: &'a AccountInfo<'info>,
    position_mint: &'a AccountInfo<'info>,
    position_token_account: &'a AccountInfo<'info>,
    token_mint_a: &'a AccountInfo<'info>,
    token_mint_b: &'a AccountInfo<'info>,
    vault_a: &'a AccountInfo<'info>,
    vault_b: &'a AccountInfo<'info>,
    orca_vault_a: &'a AccountInfo<'info>,
    orca_vault_b: &'a AccountInfo<'info>,
    tick_array_lower: &'a AccountInfo<'info>,
    tick_array_upper: &'a AccountInfo<'info>,
    token_program: &'a AccountInfo<'info>,
    associated_token_program: &'a AccountInfo<'info>,
    memo_program: &'a AccountInfo<'info>,
    whirlpool_program: &'a AccountInfo<'info>,
    market_authority: &'a AccountInfo<'info>,
}

impl<'a, 'info> MintShortAccounts<'a, 'info> {
    fn resolve(ctx: &'a Context<'info, MintPosition<'info>>) -> Result<Self> {
        macro_rules! need {
            ($f:ident) => {
                ctx.accounts
                    .$f
                    .as_ref()
                    .map(|a| a.as_ref())
                    .ok_or(PermaError::InvalidAsset)?
            };
        }
        let me = Self {
            whirlpool: need!(whirlpool),
            orca_position: need!(orca_position),
            position_mint: need!(position_mint),
            position_token_account: need!(position_token_account),
            token_mint_a: need!(token_mint_a),
            token_mint_b: need!(token_mint_b),
            vault_a: need!(vault_a),
            vault_b: need!(vault_b),
            orca_vault_a: need!(orca_vault_a),
            orca_vault_b: need!(orca_vault_b),
            tick_array_lower: need!(tick_array_lower),
            tick_array_upper: need!(tick_array_upper),
            token_program: ctx.accounts.token_program.as_ref(),
            associated_token_program: need!(associated_token_program),
            memo_program: need!(memo_program),
            whirlpool_program: need!(whirlpool_program),
            market_authority: ctx.accounts.market_authority.as_ref(),
        };
        // The signer requirement survives `Option`: Anchor only checks it when
        // present, so re-assert it - an unsigned position mint would let Orca's
        // `open_position` fail late instead of PERMA failing early.
        require!(me.position_mint.is_signer, PermaError::InvalidAsset);
        require_keys_eq!(me.vault_a.key(), ctx.accounts.market.vault_a, PermaError::InvalidAsset);
        require_keys_eq!(me.vault_b.key(), ctx.accounts.market.vault_b, PermaError::InvalidAsset);
        Ok(me)
    }
}

/// The Orca-side accounts a SHORT burn needs.
///
/// `BurnPosition` declares them `Option` because a LONG has none. Resolving
/// them here keeps the unwrapping in one place and re-asserts the `address`
/// constraints that were lost when the fields became optional - losing a check
/// to a refactor is exactly how this kind of change goes wrong.
struct BurnShortAccounts<'a, 'info> {
    whirlpool: &'a AccountInfo<'info>,
    orca_position: &'a AccountInfo<'info>,
    position_mint: &'a AccountInfo<'info>,
    position_token_account: &'a AccountInfo<'info>,
    token_mint_a: &'a AccountInfo<'info>,
    token_mint_b: &'a AccountInfo<'info>,
    vault_a: &'a AccountInfo<'info>,
    vault_b: &'a AccountInfo<'info>,
    orca_vault_a: &'a AccountInfo<'info>,
    orca_vault_b: &'a AccountInfo<'info>,
    tick_array_lower: &'a AccountInfo<'info>,
    tick_array_upper: &'a AccountInfo<'info>,
    token_program: &'a AccountInfo<'info>,
    memo_program: &'a AccountInfo<'info>,
    whirlpool_program: &'a AccountInfo<'info>,
    market_authority: &'a AccountInfo<'info>,
}

impl<'a, 'info> BurnShortAccounts<'a, 'info> {
    fn resolve(ctx: &'a Context<'info, BurnPosition<'info>>) -> Result<Self> {
        macro_rules! need {
            ($f:ident) => {
                ctx.accounts
                    .$f
                    .as_ref()
                    .map(|a| a.as_ref())
                    .ok_or(PermaError::InvalidAsset)?
            };
        }
        let me = Self {
            whirlpool: need!(whirlpool),
            orca_position: need!(orca_position),
            position_mint: need!(position_mint),
            position_token_account: need!(position_token_account),
            token_mint_a: need!(token_mint_a),
            token_mint_b: need!(token_mint_b),
            vault_a: need!(vault_a),
            vault_b: need!(vault_b),
            orca_vault_a: need!(orca_vault_a),
            orca_vault_b: need!(orca_vault_b),
            tick_array_lower: need!(tick_array_lower),
            tick_array_upper: need!(tick_array_upper),
            token_program: need!(token_program),
            memo_program: need!(memo_program),
            whirlpool_program: need!(whirlpool_program),
            market_authority: ctx.accounts.market_authority.as_ref(),
        };

        // Re-assert what the `address =` constraints used to guarantee.
        let pos = &ctx.accounts.perma_position;
        require_keys_eq!(me.orca_position.key(), pos.orca_position, PermaError::PositionAuthorityMismatch);
        require_keys_eq!(me.position_mint.key(), pos.position_mint, PermaError::PositionAuthorityMismatch);
        require_keys_eq!(me.vault_a.key(), ctx.accounts.market.vault_a, PermaError::InvalidAsset);
        require_keys_eq!(me.vault_b.key(), ctx.accounts.market.vault_b, PermaError::InvalidAsset);
        Ok(me)
    }
}

/// The LONG branch of `burn_position`.
///
/// Called after the shared `update_index` -> `poke_range` prefix.
///
/// **Settles in cash before closing.** Everything the long has accrued is
/// debited from free USDC and transferred into the range vault; only then does
/// the position close. If free USDC cannot cover it, `debit_usdc` fails with
/// `InsufficientCollateralForLoss`, the whole transaction reverts and the
/// position stays `Open` with its debt intact (`08-burn-settle.md` §G).
///
/// The Fair MVP has no liquidation (`PRD.md` §A2), so an underwater long is
/// stuck until its owner deposits more USDC. That is the specified behaviour:
/// the alternative - close anyway and park a shortfall - is precisely the
/// liability-without-cash state this component exists to remove.
///
/// **P&L is not settled here.** Component 09 owns valuation.
fn burn_long_inner<'info>(mut ctx: Context<'info, BurnPosition<'info>>) -> Result<()> {
    let market_key = ctx.accounts.market.key();
    let size = ctx.accounts.perma_position.liquidity;

    // Accrue up to now, then convert with floor-and-carry.
    premium::accrue_long(
        &ctx.accounts.premium_index,
        &ctx.accounts.market,
        &mut ctx.accounts.perma_position,
    )?;
    let payable = premium::payable_from(&mut ctx.accounts.perma_position);

    // Cash first. A zero payable is legitimate - a long closed in the same slot
    // it opened owes nothing - so this is not `NothingToSettle`.
    if payable > 0 {
        pay_long_premium_cash(&mut ctx, payable)?;
    }

    position::close_long(
        &mut ctx.accounts.perma_position,
        &mut ctx.accounts.user_collateral,
    )?;

    // Weight change, strictly after the poke.
    let range = &mut ctx.accounts.range_state;
    range.total_long_liquidity = range
        .total_long_liquidity
        .checked_sub(size)
        .ok_or(PermaError::MathOverflow)?;

    emit!(LongBurned {
        market: market_key,
        owner: ctx.accounts.owner.key(),
        perma_position: ctx.accounts.perma_position.key(),
        size,
        premium_paid_usdc: payable,
        total_long_liquidity: range.total_long_liquidity,
        available_after: range.available_short_liquidity(),
    });

    ctx.accounts
        .perma_position
        .close(ctx.accounts.owner.to_account_info())?;
    Ok(())
}

/// Resolve the three USDC accounts a burn-path settle needs.
///
/// They are `Option` on `BurnPosition` only because the LONG leg has no *Orca*
/// accounts; the premium accounts are required on both legs, so a missing one
/// is an error rather than a skipped settle.
fn burn_usdc_accounts<'a, 'info>(
    ctx: &'a Context<'info, BurnPosition<'info>>,
) -> Result<(&'a AccountInfo<'info>, &'a AccountInfo<'info>)> {
    let vault_b = ctx
        .accounts
        .vault_b
        .as_ref()
        .map(|a| a.as_ref())
        .ok_or(PermaError::InvalidAsset)?;
    let token_program = ctx
        .accounts
        .token_program
        .as_ref()
        .map(|a| a.as_ref())
        .ok_or(PermaError::InvalidAsset)?;
    require_keys_eq!(vault_b.key(), ctx.accounts.market.vault_b, PermaError::InvalidAsset);
    check_range_vault(ctx)?;
    Ok((vault_b, token_program))
}

/// `range_vault` is a bare `UncheckedAccount`, so derive and compare it.
fn check_range_vault<'info>(ctx: &Context<'info, BurnPosition<'info>>) -> Result<()> {
    let pos = &ctx.accounts.perma_position;
    let (expected, _) = Pubkey::find_program_address(
        &[
            seeds::RANGE_VAULT,
            ctx.accounts.market.key().as_ref(),
            &pos.tick_lower.to_le_bytes(),
            &pos.tick_upper.to_le_bytes(),
        ],
        ctx.program_id,
    );
    require_keys_eq!(
        ctx.accounts.range_vault.key(),
        expected,
        PermaError::RangeStateMismatch
    );
    Ok(())
}

/// Move a closing long's accrued premium into the range vault.
///
/// Debit, transfer and liability-clear in one body - the same rule
/// `settle_premium` follows, for the same reason.
fn pay_long_premium_cash<'info>(
    ctx: &mut Context<'info, BurnPosition<'info>>,
    payable: u64,
) -> Result<()> {
    let (vault_b, token_program) = {
        let (v, t) = burn_usdc_accounts(ctx)?;
        (v.clone(), t.clone())
    };

    // Refuses to raid `locked_b`, and fails the whole transaction - which is
    // what keeps an unpayable long `Open` rather than closing it into a debt.
    collateral::debit_usdc(&mut ctx.accounts.user_collateral, payable)?;

    let market_key = ctx.accounts.market.key();
    let auth_bump = [ctx.accounts.market.authority_bump];
    let signer: &[&[u8]] = &[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump];
    spl_transfer(
        &token_program,
        &vault_b,
        &ctx.accounts.range_vault.to_account_info(),
        &ctx.accounts.market_authority.to_account_info(),
        payable,
        Some(&[signer]),
    )?;

    premium::apply_long_payment(&mut ctx.accounts.range_state, payable)?;

    let user = &mut ctx.accounts.user_collateral;
    let cleared = user.premium_owed_usdc.min(payable);
    user.premium_owed_usdc -= cleared;
    Ok(())
}

/// Pay a burning short whatever the range vault can cover, before its
/// liquidity leaves `total_short_liquidity`.
///
/// Returns `(paid, still_owed)`. `paid == 0` is normal - it just means no long
/// has funded this range yet - and the unfunded remainder is carried on the
/// position, which is what sends it to `PendingPremium` instead of `Closed`.
fn claim_short_premium_cash<'info>(
    ctx: &mut Context<'info, BurnPosition<'info>>,
) -> Result<(u64, u64)> {
    let (vault_b, token_program) = {
        let (v, t) = burn_usdc_accounts(ctx)?;
        (v.clone(), t.clone())
    };

    let (paid, still_owed) = premium::claim_short_amount(
        &ctx.accounts.perma_position,
        &ctx.accounts.range_state,
    )?;

    if paid > 0 {
        let market_key = ctx.accounts.market.key();
        let auth_bump = [ctx.accounts.market.authority_bump];
        let signer: &[&[u8]] = &[seeds::MARKET_AUTHORITY, market_key.as_ref(), &auth_bump];
        spl_transfer(
            &token_program,
            &ctx.accounts.range_vault.to_account_info(),
            &vault_b,
            &ctx.accounts.market_authority.to_account_info(),
            paid,
            Some(&[signer]),
        )?;
        collateral::credit_usdc(&mut ctx.accounts.user_collateral, paid)?;
    }

    premium::apply_short_claim(
        &mut ctx.accounts.perma_position,
        &mut ctx.accounts.range_state,
        paid,
        still_owed,
    )?;
    Ok((paid, still_owed))
}

/// The LONG branch of `mint_position`.
///
/// Called after the shared `update_index` -> `poke_range` prefix has already
/// run, so the inventory figures read here are current.
///
/// A long touches **no Orca account and no vault**: it buys the right to the
/// price exposure of short liquidity someone else already provided.
fn mint_long_inner<'info>(
    ctx: Context<'info, MintPosition<'info>>,
    tick_lower: i32,
    tick_upper: i32,
    size: u128,
    nonce: u64,
) -> Result<()> {
    // Inventory gate. `available` is DERIVED - it is never stored, because a
    // stored copy invites using it as the premium denominator, which would
    // over-pay shorts as longs open (06-long-mint-inventory.md).
    let available = ctx.accounts.range_state.available_short_liquidity();
    require!(available >= size, PermaError::NoShortInventory);

    // Bound the open-long set so a withdraw can always carry it (ADR-0003).
    require!(
        ctx.accounts.user_collateral.open_longs < risk::MAX_OPEN_LONGS,
        PermaError::TooManyOpenLongs
    );

    let market_key = ctx.accounts.market.key();
    // The shared prefix already ran `update_index`, so the stored index IS the
    // projection at `now` - no separate projection step is needed here.
    let current_index = ctx.accounts.premium_index.current_index;

    // Solvency (component 09): the caller passes every existing open long as a
    // remaining account; free USDC must cover their accrued premium and margin
    // plus the margin for this new long. Replaces the `balance_b > 0` stub.
    let longs = risk::collect_open_longs(
        ctx.remaining_accounts,
        ctx.program_id,
        &market_key,
        &ctx.accounts.owner.key(),
        ctx.accounts.user_collateral.open_longs,
    )?;
    risk::check_long_mint_allowed(
        &ctx.accounts.user_collateral,
        &longs,
        current_index,
        &ctx.accounts.market,
        size,
    )?;

    let pos = &mut ctx.accounts.perma_position;
    pos.market = market_key;
    pos.owner = ctx.accounts.owner.key();
    pos.tick_lower = tick_lower;
    pos.tick_upper = tick_upper;
    pos.nonce = nonce;
    pos.bump = ctx.bumps.perma_position;
    position::open_long(pos, &mut ctx.accounts.user_collateral, size, current_index)?;

    // Weight change, strictly after the poke. `total_short_liquidity` is NOT
    // touched - those shorts are still providing that liquidity and still
    // earning on all of it.
    let range = &mut ctx.accounts.range_state;
    range.total_long_liquidity = range
        .total_long_liquidity
        .checked_add(size)
        .ok_or(PermaError::MathOverflow)?;

    emit!(LongMinted {
        market: market_key,
        owner: pos.owner,
        perma_position: pos.key(),
        tick_lower,
        tick_upper,
        size,
        entry_index: current_index,
        total_short_liquidity: range.total_short_liquidity,
        total_long_liquidity: range.total_long_liquidity,
        available_after: range.available_short_liquidity(),
    });
    Ok(())
}


/// Refuse the low-level harness on a range that has open longs.
///
/// `adapter_add_liquidity` / `adapter_remove_liquidity` do not maintain range
/// weights, so using them after longs exist would silently desync
/// `total_short_liquidity` from reality and corrupt the inventory gate.
///
/// The account is **mandatory and PDA-verified**, not optional. An earlier
/// draft made it `Option`, which meant a caller could skip the check simply by
/// passing `null` - a guard you can opt out of is not a guard. Here the caller
/// must supply the account at the derived address; an uninitialized account is
/// accepted only because it proves no short ever traded the range, so no long
/// can exist there either.
fn reject_harness_if_longs(
    range: &AccountInfo,
    market: &Pubkey,
    tick_lower: i32,
    tick_upper: i32,
    program_id: &Pubkey,
) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(
        &[
            seeds::RANGE,
            market.as_ref(),
            &tick_lower.to_le_bytes(),
            &tick_upper.to_le_bytes(),
        ],
        program_id,
    );
    require_keys_eq!(range.key(), expected, PermaError::HarnessPathUnavailable);

    if !range.data_is_empty() {
        let data = range.try_borrow_data()?;
        let state = RangePremiumState::try_deserialize(&mut &data[..])
            .map_err(|_| PermaError::HarnessPathUnavailable)?;
        require!(
            state.total_long_liquidity == 0,
            PermaError::HarnessPathUnavailable
        );
    }
    Ok(())
}

fn mint_modify_accounts<'a, 'info>(
    m: &'a MintShortAccounts<'a, 'info>,
) -> ModifyLiquidityAccounts<'info, 'a> {
    ModifyLiquidityAccounts {
        whirlpool_program: m.whirlpool_program,
        whirlpool: m.whirlpool,
        token_program_a: m.token_program,
        token_program_b: m.token_program,
        memo_program: m.memo_program,
        position_authority: m.market_authority,
        position: m.orca_position,
        position_token_account: m.position_token_account,
        token_mint_a: m.token_mint_a,
        token_mint_b: m.token_mint_b,
        token_owner_account_a: m.vault_a,
        token_owner_account_b: m.vault_b,
        token_vault_a: m.orca_vault_a,
        token_vault_b: m.orca_vault_b,
        tick_array_lower: m.tick_array_lower,
        tick_array_upper: m.tick_array_upper,
    }
}

fn burn_modify_accounts<'a, 'info>(
    b: &'a BurnShortAccounts<'a, 'info>,
) -> ModifyLiquidityAccounts<'info, 'a> {
    ModifyLiquidityAccounts {
        whirlpool_program: b.whirlpool_program,
        whirlpool: b.whirlpool,
        token_program_a: b.token_program,
        token_program_b: b.token_program,
        memo_program: b.memo_program,
        position_authority: b.market_authority,
        position: b.orca_position,
        position_token_account: b.position_token_account,
        token_mint_a: b.token_mint_a,
        token_mint_b: b.token_mint_b,
        token_owner_account_a: b.vault_a,
        token_owner_account_b: b.vault_b,
        token_vault_a: b.orca_vault_a,
        token_vault_b: b.orca_vault_b,
        tick_array_lower: b.tick_array_lower,
        tick_array_upper: b.tick_array_upper,
    }
}

/// Note the ordering: owner/vault interleaved per token, programs last.
/// Deliberately not derived from [`burn_modify_accounts`].
fn burn_collect_accounts<'a, 'info>(
    b: &'a BurnShortAccounts<'a, 'info>,
) -> CollectFeesAccounts<'info, 'a> {
    CollectFeesAccounts {
        whirlpool_program: b.whirlpool_program,
        whirlpool: b.whirlpool,
        position_authority: b.market_authority,
        position: b.orca_position,
        position_token_account: b.position_token_account,
        token_mint_a: b.token_mint_a,
        token_mint_b: b.token_mint_b,
        token_owner_account_a: b.vault_a,
        token_vault_a: b.orca_vault_a,
        token_owner_account_b: b.vault_b,
        token_vault_b: b.orca_vault_b,
        token_program_a: b.token_program,
        token_program_b: b.token_program,
        memo_program: b.memo_program,
    }
}

fn modify_accounts<'a, 'b>(
    ctx: &'b Context<'a, AdapterAddLiquidity<'a>>,
) -> ModifyLiquidityAccounts<'a, 'b> {
    ModifyLiquidityAccounts {
        whirlpool_program: &ctx.accounts.whirlpool_program,
        whirlpool: &ctx.accounts.whirlpool,
        token_program_a: &ctx.accounts.token_program_a,
        token_program_b: &ctx.accounts.token_program_b,
        memo_program: &ctx.accounts.memo_program,
        position_authority: &ctx.accounts.market_authority,
        position: &ctx.accounts.orca_position,
        position_token_account: &ctx.accounts.position_token_account,
        token_mint_a: &ctx.accounts.token_mint_a,
        token_mint_b: &ctx.accounts.token_mint_b,
        token_owner_account_a: &ctx.accounts.vault_a,
        token_owner_account_b: &ctx.accounts.vault_b,
        token_vault_a: &ctx.accounts.orca_vault_a,
        token_vault_b: &ctx.accounts.orca_vault_b,
        tick_array_lower: &ctx.accounts.tick_array_lower,
        tick_array_upper: &ctx.accounts.tick_array_upper,
    }
}

fn modify_accounts_remove<'a, 'b>(
    ctx: &'b Context<'a, AdapterRemoveLiquidity<'a>>,
) -> ModifyLiquidityAccounts<'a, 'b> {
    ModifyLiquidityAccounts {
        whirlpool_program: &ctx.accounts.whirlpool_program,
        whirlpool: &ctx.accounts.whirlpool,
        token_program_a: &ctx.accounts.token_program_a,
        token_program_b: &ctx.accounts.token_program_b,
        memo_program: &ctx.accounts.memo_program,
        position_authority: &ctx.accounts.market_authority,
        position: &ctx.accounts.orca_position,
        position_token_account: &ctx.accounts.position_token_account,
        token_mint_a: &ctx.accounts.token_mint_a,
        token_mint_b: &ctx.accounts.token_mint_b,
        token_owner_account_a: &ctx.accounts.vault_a,
        token_owner_account_b: &ctx.accounts.vault_b,
        token_vault_a: &ctx.accounts.orca_vault_a,
        token_vault_b: &ctx.accounts.orca_vault_b,
        tick_array_lower: &ctx.accounts.tick_array_lower,
        tick_array_upper: &ctx.accounts.tick_array_upper,
    }
}

/// Note the ordering: owner/vault interleaved per token, programs last.
/// Deliberately not derived from [`modify_accounts_remove`].
fn collect_accounts<'a, 'b>(
    ctx: &'b Context<'a, AdapterRemoveLiquidity<'a>>,
) -> CollectFeesAccounts<'a, 'b> {
    CollectFeesAccounts {
        whirlpool_program: &ctx.accounts.whirlpool_program,
        whirlpool: &ctx.accounts.whirlpool,
        position_authority: &ctx.accounts.market_authority,
        position: &ctx.accounts.orca_position,
        position_token_account: &ctx.accounts.position_token_account,
        token_mint_a: &ctx.accounts.token_mint_a,
        token_mint_b: &ctx.accounts.token_mint_b,
        token_owner_account_a: &ctx.accounts.vault_a,
        token_vault_a: &ctx.accounts.orca_vault_a,
        token_owner_account_b: &ctx.accounts.vault_b,
        token_vault_b: &ctx.accounts.orca_vault_b,
        token_program_a: &ctx.accounts.token_program_a,
        token_program_b: &ctx.accounts.token_program_b,
        memo_program: &ctx.accounts.memo_program,
    }
}

// --- contexts ------------------------------------------------------------

/// One atomic short open: `open_position` + `increase_liquidity_v2` + books.
#[derive(Accounts)]
#[instruction(leg: u8, tick_lower: i32, tick_upper: i32, liquidity: u128, token_max_a: u64, token_max_b: u64, nonce: u64)]
pub struct MintPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: Orca `position_authority`; owns the position NFT and both vaults.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump = user_collateral.bump,
        has_one = market,
        has_one = owner,
    )]
    pub user_collateral: Account<'info, UserCollateral>,

    #[account(
        init,
        payer = owner,
        space = 8 + PermaPosition::INIT_SPACE,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub perma_position: Account<'info, PermaPosition>,

    /// Premium clock for this market. Lazily created on first mint.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + GlobalPremiumIndex::INIT_SPACE,
        seeds = [seeds::PREMIUM_INDEX, market.key().as_ref()],
        bump
    )]
    pub premium_index: Account<'info, GlobalPremiumIndex>,

    /// Per-range inventory + entitlement ledger. Created by the first short in
    /// the range; a long can only ever find it already there.
    ///
    /// Seeds use `to_le_bytes()` - NOT the `to_string()` form Orca's TickArray
    /// PDA uses. See `state::seeds::RANGE`.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + RangePremiumState::INIT_SPACE,
        seeds = [seeds::RANGE, market.key().as_ref(), &tick_lower.to_le_bytes(), &tick_upper.to_le_bytes()],
        bump
    )]
    pub range_state: Account<'info, RangePremiumState>,

    /// Per-range premium escrow (USDC). Created alongside the range by the
    /// first short, so every settle path can assume it exists and the
    /// invariant `range_vault.amount == premium_pool + dust` holds from t=0.
    ///
    /// **Not** `Market.vault_b` - keeping the escrow separate is what makes the
    /// collateral conservation check independently verifiable (ADR-0002).
    /// CHECK: the PERMA PDA `["range_vault", market, lower_le, upper_le]` - a
    /// token account with mint `token_mint_b` and owner `market_authority`,
    /// derived and created in the handler. **Not** the canonical ATA of
    /// (`market_authority`, `token_mint_b`): that address *is* `Market.vault_b`,
    /// and an early prototype of this component derived exactly that by
    /// mistake. `UncheckedAccount` because `anchor-spl` is deliberately absent
    /// from this program (ADR-0001) - adding it risks pulling a second
    /// `solana-*` crate family alongside the Orca client.
    #[account(mut)]
    pub range_vault: UncheckedAccount<'info>,

    // --- Orca accounts: SHORT only ---
    // A LONG has no Orca position, so these are `Option` and passed as `null`
    // (component 09). That is what keeps a long mint small enough to also
    // carry the owner's open longs as remaining accounts: with these required,
    // a long mint measured 1188 B - room for ONE remaining account, and a mint
    // paid for by a different fee payer was already over the limit. The SHORT
    // branch requires every one of them; see `MintShortAccounts::resolve`.
    /// CHECK: validated against `market.whirlpool`.
    #[account(mut)]
    pub whirlpool: Option<UncheckedAccount<'info>>,
    /// CHECK: Orca `Position` PDA; derived and checked in the handler.
    #[account(mut)]
    pub orca_position: Option<UncheckedAccount<'info>>,
    /// CHECK: ephemeral signer; Orca inits it as a 0-decimal mint.
    #[account(mut)]
    pub position_mint: Option<Signer<'info>>,
    /// CHECK: ATA of (`market_authority`, `position_mint`), init'd by Orca.
    #[account(mut)]
    pub position_token_account: Option<UncheckedAccount<'info>>,

    /// CHECK: must equal `whirlpool.token_mint_a`.
    pub token_mint_a: Option<UncheckedAccount<'info>>,
    /// CHECK: must equal `whirlpool.token_mint_b`.
    pub token_mint_b: Option<UncheckedAccount<'info>>,

    /// CHECK: PERMA WSOL vault.
    #[account(mut, address = market.vault_a)]
    pub vault_a: Option<UncheckedAccount<'info>>,
    /// CHECK: PERMA devUSDC vault.
    #[account(mut, address = market.vault_b)]
    pub vault_b: Option<UncheckedAccount<'info>>,

    /// CHECK: must equal `whirlpool.token_vault_a`.
    #[account(mut)]
    pub orca_vault_a: Option<UncheckedAccount<'info>>,
    /// CHECK: must equal `whirlpool.token_vault_b`.
    #[account(mut)]
    pub orca_vault_b: Option<UncheckedAccount<'info>>,

    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_lower: Option<UncheckedAccount<'info>>,
    /// CHECK: validated against its derived PDA. May equal the lower array.
    #[account(mut)]
    pub tick_array_upper: Option<UncheckedAccount<'info>>,

    /// CHECK: SPL Token program (both mints are legacy SPL).
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: SPL Associated Token Account program.
    pub associated_token_program: Option<UncheckedAccount<'info>>,
    /// CHECK: SPL Memo, required by every v2 liquidity instruction.
    pub memo_program: Option<UncheckedAccount<'info>>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Accounts for [`perma::settle_premium`].
///
/// Deliberately small: no Orca accounts, no tick arrays, no mints. Settling is
/// a USDC transfer between two PERMA-owned token accounts plus bookkeeping.
#[derive(Accounts)]
pub struct SettlePremium<'info> {
    /// Whoever is paying for the transaction. For a LONG this may be anybody
    /// (§C); for a SHORT the handler requires it to equal `owner`.
    pub cranker: Signer<'info>,

    /// CHECK: the position's owner. Not a signer - a long can be cranked by a
    /// stranger. Receives the rent when a `PendingPremium` short finally
    /// closes, which is why it is `mut`.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: owns both `vault_b` and the range vault; signs the transfer.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump = user_collateral.bump,
        has_one = market,
        has_one = owner,
    )]
    pub user_collateral: Account<'info, UserCollateral>,

    #[account(
        mut,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &perma_position.nonce.to_le_bytes()],
        bump = perma_position.bump,
        has_one = market,
        has_one = owner,
    )]
    pub perma_position: Account<'info, PermaPosition>,

    #[account(mut, seeds = [seeds::PREMIUM_INDEX, market.key().as_ref()], bump = premium_index.bump)]
    pub premium_index: Account<'info, GlobalPremiumIndex>,

    /// Seeded from the *position's* ticks, so a caller cannot settle against
    /// some other range's accumulator.
    #[account(
        mut,
        seeds = [seeds::RANGE, market.key().as_ref(), &perma_position.tick_lower.to_le_bytes(), &perma_position.tick_upper.to_le_bytes()],
        bump = range_state.bump
    )]
    pub range_state: Account<'info, RangePremiumState>,

    /// CHECK: the premium escrow PDA, derived in the handler. **Not**
    /// `Market.vault_b` - see `MintPosition::range_vault`.
    #[account(mut)]
    pub range_vault: UncheckedAccount<'info>,

    /// CHECK: the shared PERMA devUSDC collateral vault.
    #[account(mut, address = market.vault_b)]
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
}

/// Full short close: decrease -> collect -> close, then release collateral.
#[derive(Accounts)]
pub struct BurnPosition<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: Orca `position_authority`.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump = user_collateral.bump,
        has_one = market,
        has_one = owner,
    )]
    pub user_collateral: Account<'info, UserCollateral>,

    /// **Not** `close = owner`. A short that still has an unfunded premium
    /// claim ends `PendingPremium` and its account must survive to carry it;
    /// the handler closes the account explicitly on every other path.
    #[account(
        mut,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &perma_position.nonce.to_le_bytes()],
        bump = perma_position.bump,
        has_one = market,
        has_one = owner,
    )]
    pub perma_position: Account<'info, PermaPosition>,

    #[account(mut, seeds = [seeds::PREMIUM_INDEX, market.key().as_ref()], bump = premium_index.bump)]
    pub premium_index: Account<'info, GlobalPremiumIndex>,

    #[account(
        mut,
        seeds = [seeds::RANGE, market.key().as_ref(), &perma_position.tick_lower.to_le_bytes(), &perma_position.tick_upper.to_le_bytes()],
        bump = range_state.bump
    )]
    pub range_state: Account<'info, RangePremiumState>,

    /// Premium escrow for this range. Mandatory on **both** legs: a long pays
    /// into it before it may close, a short claims out of it before its
    /// liquidity leaves the denominator.
    /// CHECK: PDA-derived in the handler; **not** `Market.vault_b`.
    #[account(mut)]
    pub range_vault: UncheckedAccount<'info>,

    /// CHECK: validated against `market.whirlpool`.
    #[account(mut)]
    pub whirlpool: Option<UncheckedAccount<'info>>,
    // --- Orca accounts: SHORT only ---
    // A LONG has no Orca position, so these are `Option` and passed as `null`.
    // The SHORT branch requires them present; see `burn_position`.
    /// CHECK: matched against `perma_position.orca_position`.
    #[account(mut)]
    pub orca_position: Option<UncheckedAccount<'info>>,
    /// CHECK: burned by Orca at close.
    #[account(mut)]
    pub position_mint: Option<UncheckedAccount<'info>>,
    /// CHECK: position NFT ATA owned by `market_authority`.
    #[account(mut)]
    pub position_token_account: Option<UncheckedAccount<'info>>,

    /// CHECK: must equal `whirlpool.token_mint_a`.
    pub token_mint_a: Option<UncheckedAccount<'info>>,
    /// CHECK: must equal `whirlpool.token_mint_b`.
    pub token_mint_b: Option<UncheckedAccount<'info>>,

    /// CHECK: PERMA WSOL vault.
    #[account(mut)]
    pub vault_a: Option<UncheckedAccount<'info>>,
    /// CHECK: PERMA devUSDC vault.
    #[account(mut)]
    pub vault_b: Option<UncheckedAccount<'info>>,

    /// CHECK: must equal `whirlpool.token_vault_a`.
    #[account(mut)]
    pub orca_vault_a: Option<UncheckedAccount<'info>>,
    /// CHECK: must equal `whirlpool.token_vault_b`.
    #[account(mut)]
    pub orca_vault_b: Option<UncheckedAccount<'info>>,

    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_lower: Option<UncheckedAccount<'info>>,
    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_upper: Option<UncheckedAccount<'info>>,

    /// CHECK: SPL Token program.
    pub token_program: Option<UncheckedAccount<'info>>,
    /// CHECK: SPL Memo.
    pub memo_program: Option<UncheckedAccount<'info>>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserCollateral::INIT_SPACE,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_collateral: Account<'info, UserCollateral>,

    /// CHECK: validated as an SPL account for `market.token_mint_a` owned by `owner`.
    #[account(mut)]
    pub user_token_a: UncheckedAccount<'info>,
    /// CHECK: validated as an SPL account for `market.token_mint_b` owned by `owner`.
    #[account(mut)]
    pub user_token_b: UncheckedAccount<'info>,

    /// CHECK: the market's WSOL vault.
    #[account(mut, address = market.vault_a)]
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: the market's devUSDC vault.
    #[account(mut, address = market.vault_b)]
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: signs the vault -> user transfer.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// `has_one = owner` is what stops one user draining another's ledger.
    #[account(
        mut,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump = user_collateral.bump,
        has_one = market,
        has_one = owner,
    )]
    pub user_collateral: Account<'info, UserCollateral>,

    /// CHECK: validated as an SPL account for `market.token_mint_a` owned by `owner`.
    #[account(mut)]
    pub user_token_a: UncheckedAccount<'info>,
    /// CHECK: validated as an SPL account for `market.token_mint_b` owned by `owner`.
    #[account(mut)]
    pub user_token_b: UncheckedAccount<'info>,

    /// CHECK: the market's WSOL vault.
    #[account(mut, address = market.vault_a)]
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: the market's devUSDC vault.
    #[account(mut, address = market.vault_b)]
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,

    /// The premium clock, read-only, for projecting open-long liability
    /// (component 09). `UncheckedAccount` on purpose: on a fresh ledger a user
    /// can withdraw before any mint has lazily created it, so it may not exist
    /// - and then it is not needed, because no long can exist either. The
    /// handler derives the PDA and deserializes only when `open_longs > 0`.
    /// CHECK: PDA-derived in the handler.
    pub premium_index: UncheckedAccount<'info>,
}
// remaining_accounts: every open LONG `PermaPosition` for (market, owner) -
// exactly `user_collateral.open_longs` of them, else `MissingOpenLong`.

/// Shared by `lock_collateral` and `unlock_collateral` - no tokens move, so no
/// vaults or token program are needed.
#[derive(Accounts)]
pub struct AdjustLock<'info> {
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [seeds::COLLATERAL, market.key().as_ref(), owner.key().as_ref()],
        bump = user_collateral.bump,
        has_one = market,
        has_one = owner,
    )]
    pub user_collateral: Account<'info, UserCollateral>,
}

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    /// Becomes the protocol admin.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [seeds::GLOBAL_CONFIG],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    /// Must equal `global_config.admin`; checked in the handler.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [seeds::GLOBAL_CONFIG], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,

    /// `init` also enforces one market per pool - a second call surfaces
    /// Anchor's account-already-in-use error, mapped to `MarketAlreadyExists`.
    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [seeds::MARKET, whirlpool.key().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: PDA that signs every Orca CPI. Never holds data.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: deserialized and validated in the handler.
    pub whirlpool: UncheckedAccount<'info>,

    /// CHECK: PERMA token A vault, owned by `market_authority`.
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: PERMA token B vault, owned by `market_authority`.
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: checked against the pinned Whirlpool program ID.
    pub whirlpool_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateShortRange<'info> {
    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: PDA, no data.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    /// CHECK: validated against `market.whirlpool`.
    pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: validated against its derived PDA.
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: validated against its derived PDA.
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(tick_lower: i32, tick_upper: i32, nonce: u64)]
pub struct AdapterOpenPosition<'info> {
    /// Funds the Orca position, mint, ATA, and the PERMA position record.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: becomes the Orca position NFT owner and later `position_authority`.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + PermaPosition::INIT_SPACE,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub perma_position: Account<'info, PermaPosition>,

    /// CHECK: validated against `market.whirlpool`.
    pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: Orca `Position` PDA; derived and checked in the handler, init'd by Orca.
    #[account(mut)]
    pub orca_position: UncheckedAccount<'info>,
    /// CHECK: ephemeral signer; Orca inits it as a 0-decimal mint.
    #[account(mut)]
    pub position_mint: Signer<'info>,
    /// CHECK: ATA of (`market_authority`, `position_mint`), init'd by Orca.
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: SPL Associated Token Account program.
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AdapterClosePosition<'info> {
    /// Receives the reclaimed rent from both the Orca position and its mint.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: the Orca `position_authority`.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &perma_position.nonce.to_le_bytes()],
        bump = perma_position.bump,
        has_one = market,
        has_one = owner,
    )]
    pub perma_position: Account<'info, PermaPosition>,

    /// CHECK: matched against `perma_position.orca_position`.
    #[account(mut)]
    pub orca_position: UncheckedAccount<'info>,
    /// CHECK: burned by Orca.
    #[account(mut, address = perma_position.position_mint)]
    pub position_mint: UncheckedAccount<'info>,
    /// CHECK: the position NFT ATA owned by `market_authority`.
    #[account(mut)]
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: SPL Token program.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(tick_lower: i32, tick_upper: i32)]
pub struct AdapterAddLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: the sole Orca `position_authority`.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &perma_position.nonce.to_le_bytes()],
        bump = perma_position.bump,
        has_one = market,
        has_one = owner,
    )]
    pub perma_position: Account<'info, PermaPosition>,

    /// CHECK: validated against `market.whirlpool`.
    #[account(mut)]
    pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: Orca `Position`, validated by Orca via `has_one = whirlpool`.
    #[account(mut)]
    pub orca_position: UncheckedAccount<'info>,
    /// CHECK: position NFT ATA owned by `market_authority`.
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: must equal `whirlpool.token_mint_a`.
    pub token_mint_a: UncheckedAccount<'info>,
    /// CHECK: must equal `whirlpool.token_mint_b`.
    pub token_mint_b: UncheckedAccount<'info>,

    /// CHECK: PERMA vault A; source of token A.
    #[account(mut, address = market.vault_a)]
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: PERMA vault B; source of token B.
    #[account(mut, address = market.vault_b)]
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: must equal `whirlpool.token_vault_a`.
    #[account(mut)]
    pub orca_vault_a: UncheckedAccount<'info>,
    /// CHECK: must equal `whirlpool.token_vault_b`.
    #[account(mut)]
    pub orca_vault_b: UncheckedAccount<'info>,

    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: validated against its derived PDA. May equal `tick_array_lower`.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: owner of `token_mint_a`.
    pub token_program_a: UncheckedAccount<'info>,
    /// CHECK: owner of `token_mint_b`.
    pub token_program_b: UncheckedAccount<'info>,
    /// CHECK: SPL Memo, required by every v2 liquidity instruction.
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: the range ledger for these ticks. **Mandatory** - the address is
    /// derived and compared in the handler, so the harness guard cannot be
    /// skipped by omitting it. May be uninitialized, which proves no short ever
    /// traded this range.
    pub range_state: UncheckedAccount<'info>,

}

#[derive(Accounts)]
#[instruction(tick_lower: i32, tick_upper: i32)]
pub struct AdapterRemoveLiquidity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [seeds::MARKET, market.whirlpool.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,

    /// CHECK: the sole Orca `position_authority`.
    #[account(seeds = [seeds::MARKET_AUTHORITY, market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [seeds::PERMA_POSITION, market.key().as_ref(), owner.key().as_ref(), &perma_position.nonce.to_le_bytes()],
        bump = perma_position.bump,
        has_one = market,
        has_one = owner,
    )]
    pub perma_position: Account<'info, PermaPosition>,

    /// CHECK: validated against `market.whirlpool`.
    #[account(mut)]
    pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: Orca `Position`.
    #[account(mut)]
    pub orca_position: UncheckedAccount<'info>,
    /// CHECK: position NFT ATA owned by `market_authority`.
    pub position_token_account: UncheckedAccount<'info>,

    /// CHECK: must equal `whirlpool.token_mint_a`.
    pub token_mint_a: UncheckedAccount<'info>,
    /// CHECK: must equal `whirlpool.token_mint_b`.
    pub token_mint_b: UncheckedAccount<'info>,

    /// CHECK: PERMA vault A; destination for withdrawn token A.
    #[account(mut, address = market.vault_a)]
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: PERMA vault B; destination for withdrawn token B.
    #[account(mut, address = market.vault_b)]
    pub vault_b: UncheckedAccount<'info>,

    /// CHECK: must equal `whirlpool.token_vault_a`.
    #[account(mut)]
    pub orca_vault_a: UncheckedAccount<'info>,
    /// CHECK: must equal `whirlpool.token_vault_b`.
    #[account(mut)]
    pub orca_vault_b: UncheckedAccount<'info>,

    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: validated against its derived PDA.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// CHECK: owner of `token_mint_a`.
    pub token_program_a: UncheckedAccount<'info>,
    /// CHECK: owner of `token_mint_b`.
    pub token_program_b: UncheckedAccount<'info>,
    /// CHECK: SPL Memo.
    pub memo_program: UncheckedAccount<'info>,
    /// CHECK: checked against the pinned program ID.
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: the range ledger for these ticks. **Mandatory** - the address is
    /// derived and compared in the handler, so the harness guard cannot be
    /// skipped by omitting it. May be uninitialized, which proves no short ever
    /// traded this range.
    pub range_state: UncheckedAccount<'info>,

}

// --- events --------------------------------------------------------------

#[event]
pub struct CollateralDeposited {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub balance_a: u64,
    pub balance_b: u64,
}

#[event]
pub struct CollateralWithdrawn {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub balance_a: u64,
    pub balance_b: u64,
}

#[event]
pub struct CollateralLocked {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub locked_a: u64,
    pub locked_b: u64,
}

#[event]
pub struct CollateralUnlocked {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub locked_a: u64,
    pub locked_b: u64,
}

#[event]
pub struct GlobalConfigInitialized {
    pub admin: Pubkey,
    pub allowlisted_whirlpool: Pubkey,
}

/// Additive only - existing consumers keep the first three fields.
#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub whirlpool: Pubkey,
    pub tick_spacing: u16,
    pub admin: Pubkey,
    pub premium_rate: u64,
    pub premium_multiplier: u64,
}

#[event]
pub struct RangeValidated {
    pub market: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub tick_array_lower: Pubkey,
    pub tick_array_upper: Pubkey,
    pub current_tick: i32,
    pub sqrt_price_x64: u128,
}

/// The product-path events. `adapter_*` emit the lower-level
/// `PositionOpened`/`LiquidityAdded`/... pair instead.
#[event]
pub struct ShortMinted {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub perma_position: Pubkey,
    pub orca_position: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
    /// The **observed** spend that was locked, not the caller's cap.
    pub locked_a: u64,
    pub locked_b: u64,
    pub open_positions: u16,
}

#[event]
pub struct LongMinted {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub perma_position: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub size: u128,
    pub entry_index: u128,
    /// Unchanged by a long - the shorts still provide it all.
    pub total_short_liquidity: u128,
    pub total_long_liquidity: u128,
    pub available_after: u128,
}

/// Emitted by every `settle_premium` path. `amount` is the USDC that actually
/// moved - there is no settle event without a transfer.
#[event]
pub struct PremiumSettled {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub perma_position: Pubkey,
    pub leg_type: u8,
    pub amount: u64,
    /// SHORT only: entitlement the pool could not cover, carried forward.
    pub still_owed: u64,
    pub premium_pool: u64,
    pub premium_owed_usdc: u64,
}

#[event]
pub struct LongBurned {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub perma_position: Pubkey,
    pub size: u128,
    /// USDC actually transferred into the range vault by this burn.
    pub premium_paid_usdc: u64,
    pub total_long_liquidity: u128,
    pub available_after: u128,
}

#[event]
pub struct ShortBurned {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub perma_position: Pubkey,
    pub liquidity: u128,
    /// Collateral released (what mint locked).
    pub unlocked_a: u64,
    pub unlocked_b: u64,
    /// What Orca actually returned. `returned - unlocked` is realized PnL.
    pub returned_a: u64,
    pub returned_b: u64,
    /// Premium paid out of the range vault during this burn.
    pub premium_claimed: u64,
    /// Entitlement the pool could not cover; carried on the position.
    pub premium_receivable: u64,
    /// `CLOSED`, or `PENDING_PREMIUM` when `premium_receivable > 0`.
    pub status: u8,
    pub open_positions: u16,
}

#[event]
pub struct PositionOpened {
    pub market: Pubkey,
    pub perma_position: Pubkey,
    pub orca_position: Pubkey,
    pub position_mint: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
}

#[event]
pub struct PositionClosed {
    pub market: Pubkey,
    pub perma_position: Pubkey,
    pub orca_position: Pubkey,
}

#[event]
pub struct LiquidityAdded {
    pub market: Pubkey,
    pub perma_position: Pubkey,
    pub orca_position: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub market: Pubkey,
    pub perma_position: Pubkey,
    pub orca_position: Pubkey,
    pub liquidity: u128,
    pub amount_a: u64,
    pub amount_b: u64,
    pub closed: bool,
}
