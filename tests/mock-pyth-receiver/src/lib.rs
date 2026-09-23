//! Mock Pyth Solana Receiver - **localnet test harness only** (ADR-0004).
//!
//! Loaded at the real receiver address so PERMA's owner check passes, and
//! writes accounts with the receiver's exact `PriceUpdateV2` borsh layout (the
//! same struct name gives the same discriminator). Unlike the real receiver it
//! lets anyone set any price - which is the point: the P3 fixtures need stale,
//! wide, deviating and Partial updates on demand. Never deploy to devnet.

use anchor_lang::prelude::*;

declare_id!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

#[program]
pub mod mock_pyth_receiver {
    use super::*;

    /// Write the update at `["price_feed", feed_id, tag]`, creating it on first
    /// use. `publish_time = now − age_secs` on the validator clock.
    #[allow(clippy::too_many_arguments)]
    pub fn set_price(
        ctx: Context<SetPrice>,
        feed_id: [u8; 32],
        _tag: u8,
        price: i64,
        conf: u64,
        exponent: i32,
        age_secs: i64,
        full: bool,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let publish_time = clock.unix_timestamp - age_secs;
        let u = &mut ctx.accounts.price_update;
        u.write_authority = ctx.accounts.payer.key();
        u.verification_level = if full {
            VerificationLevel::Full
        } else {
            VerificationLevel::Partial { num_signatures: 5 }
        };
        u.price_message = PriceFeedMessage {
            feed_id,
            price,
            conf,
            exponent,
            publish_time,
            prev_publish_time: publish_time,
            ema_price: price,
            ema_conf: conf,
        };
        u.posted_slot = clock.slot;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32], tag: u8)]
pub struct SetPrice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 134, // the receiver's allocation: 8 + 32 + 2 + 84 + 8
        seeds = [b"price_feed", feed_id.as_ref(), &[tag]],
        bump
    )]
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

/// Field-for-field the receiver's `PriceUpdateV2`.
#[account]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}
