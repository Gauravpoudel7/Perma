//! Oracle - **Protocol V1 P3** (ADR-0004).
//!
//! # What this is
//!
//! One fail-closed question, asked before `mint_position` opens any new
//! exposure: *is the Whirlpool's spot within `MAX_DEVIATION_BPS` of a fresh,
//! confident, externally verified reference price?* The reference is a Pyth
//! pull `PriceUpdateV2` account for SOL/USD. `force_exercise` (ADR-0005) asks
//! the same question with a 30 s window, after [`is_exercisable`].
//!
//! # What this is not
//!
//! - **Not a TWAP.** The Whirlpool `Oracle` PDA is adaptive-fee state
//!   (`volatility_accumulator` & co. in `orca_whirlpools_client` 8.0.0) and is
//!   never read here or anywhere in PERMA.
//! - **Not a price input to solvency.** `risk.rs` is untouched; spot is
//!   *compared* against the reference, never used as a price.
//! - **Not on any owner exit path.** Burn, settle, unlock and withdraw never
//!   call this, so an oracle outage cannot trap funds. It refuses only a
//!   third party's force exercise.
//!
//! # Why hand-parsed
//!
//! `pyth-solana-receiver-sdk` 2.0.0 is anchor-1.x compatible but drags the
//! `pythnet-sdk` tree into the binary for a fixed 134-byte account. The layout
//! below is borsh of the receiver's `PriceUpdateV2` with `VerificationLevel::Full`.

use anchor_lang::prelude::*;

use crate::errors::PermaError;

/// Pyth Solana Receiver. Every genuine `PriceUpdateV2` is owned by it. On
/// localnet a mock is loaded at this address (`tests/mock-pyth-receiver`).
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Pyth `SOL/USD`. devUSDC is treated as USD 1:1 (ADR-0004 pair policy).
pub const SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

/// `sha256("account:PriceUpdateV2")[..8]`.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
/// Through `posted_slot` with a one-byte (`Full`) verification level.
const PRICE_UPDATE_V2_MIN_LEN: usize = 133;
const VERIFICATION_FULL: u8 = 1;

/// ADR-0004 numeric policy. Demo values; change only by amending the ADR.
pub const MAX_STALENESS_SECS: i64 = 60;
pub const MAX_CONF_BPS: u128 = 100;
pub const MAX_DEVIATION_BPS: u128 = 200;
const BPS: u128 = 10_000;

/// `decimals(WSOL) − decimals(devUSDC)`. ponytail: single allowlisted pool,
/// move onto `Market` when P6 adds a second pair.
const SPOT_DECIMAL_SHIFT: u32 = 9 - 6;

/// The fields of a `PriceUpdateV2` this module uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceMsg {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

/// Validate a `PriceUpdateV2` account and return its price message.
/// Any authenticity failure is `OracleUnavailable`.
pub fn load_price_update(info: &AccountInfo) -> Result<PriceMsg> {
    require_keys_eq!(*info.owner, PYTH_RECEIVER_ID, PermaError::OracleUnavailable);
    parse_price_update(&info.try_borrow_data()?)
}

fn parse_price_update(data: &[u8]) -> Result<PriceMsg> {
    require!(
        data.len() >= PRICE_UPDATE_V2_MIN_LEN
            && data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR
            && data[40] == VERIFICATION_FULL
            && data[41..73] == SOL_USD_FEED_ID,
        PermaError::OracleUnavailable
    );
    let i64_at = |o: usize| i64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    let msg = PriceMsg {
        price: i64_at(73),
        conf: u64::from_le_bytes(data[81..89].try_into().unwrap()),
        exponent: i32::from_le_bytes(data[89..93].try_into().unwrap()),
        publish_time: i64_at(93),
    };
    require!(
        msg.price > 0 && (-12..=0).contains(&msg.exponent),
        PermaError::OracleUnavailable
    );
    Ok(msg)
}

/// Whirlpool `sqrt_price` (Q64.64, raw B per raw A) in the reference's units:
/// USD per SOL × 10^(−exponent).
///
/// ponytail: squares `sqrt >> 32`, ~32 bits of precision - far finer than 1 bp
/// at any realistic price; use a 256-bit product if a pool ever sits near the
/// sqrt bounds (overflow fails `MathOverflow`, never wraps).
pub fn spot_in_price_units(sqrt_price_x64: u128, exponent: i32) -> Result<u128> {
    let s = sqrt_price_x64 >> 32;
    let scale = 10u128.pow(SPOT_DECIMAL_SHIFT + exponent.unsigned_abs());
    let v = s
        .checked_mul(s)
        .and_then(|x| x.checked_mul(scale))
        .ok_or(PermaError::MathOverflow)?;
    Ok(v >> 64)
}

/// ADR-0004 checks in order: staleness → confidence → deviation.
pub fn check_price(msg: &PriceMsg, now_ts: i64, sqrt_price_x64: u128) -> Result<()> {
    require!(
        now_ts.saturating_sub(msg.publish_time) <= MAX_STALENESS_SECS,
        PermaError::OracleStale
    );

    let price = msg.price as u128; // > 0, checked at parse
    let conf_lhs = (msg.conf as u128).checked_mul(BPS).ok_or(PermaError::MathOverflow)?;
    require!(conf_lhs <= MAX_CONF_BPS * price, PermaError::OracleConfidenceTooWide);

    let spot = spot_in_price_units(sqrt_price_x64, msg.exponent)?;
    let dev_lhs = spot
        .abs_diff(price)
        .checked_mul(BPS)
        .ok_or(PermaError::MathOverflow)?;
    require!(dev_lhs <= MAX_DEVIATION_BPS * price, PermaError::OracleDeviationTooHigh);
    Ok(())
}

/// ADR-0005 §3 force-exercise policy. Demo values; change only by amending the ADR.
pub const FX_BAND_TICKS: i32 = 310;
pub const FX_MAX_STALENESS_SECS: i64 = 30;

/// Is the pool tick `FX_BAND_TICKS` beyond the long's `[lower, upper)` range?
///
/// Wide enough that a tick this far out which also passes [`check_price`]
/// puts the reference outside the range at `price ± conf` - see the
/// `fx_band_covers_deviation_and_confidence` test. Spot alone can never
/// trigger an exercise.
pub fn is_exercisable(tick_lower: i32, tick_upper: i32, tick: i32) -> bool {
    tick >= tick_upper.saturating_add(FX_BAND_TICKS)
        || tick.saturating_add(FX_BAND_TICKS) < tick_lower
}

/// The force-exercise gate: [`check_price`] inside the tighter P4 window.
pub fn check_exercise_price(price_update: &AccountInfo, sqrt_price_x64: u128) -> Result<PriceMsg> {
    let msg = load_price_update(price_update)?;
    let now = Clock::get()?.unix_timestamp;
    require!(
        now.saturating_sub(msg.publish_time) <= FX_MAX_STALENESS_SECS,
        PermaError::OracleStale
    );
    check_price(&msg, now, sqrt_price_x64)?;
    Ok(msg)
}

/// The mint gate: authentic account, then [`check_price`] against the pool.
pub fn check_mint_price(price_update: &AccountInfo, sqrt_price_x64: u128) -> Result<()> {
    let msg = load_price_update(price_update)?;
    check_price(&msg, Clock::get()?.unix_timestamp, sqrt_price_x64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPO: i32 = -8;
    const NOW: i64 = 1_800_000_000;

    /// A `PriceUpdateV2` byte image exactly as the receiver writes it (Full).
    fn image(feed: [u8; 32], level: u8, price: i64, conf: u64, expo: i32, publish: i64) -> Vec<u8> {
        let mut d = Vec::with_capacity(134);
        d.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        d.extend_from_slice(&[7u8; 32]); // write_authority
        d.push(level);
        d.extend_from_slice(&feed);
        d.extend_from_slice(&price.to_le_bytes());
        d.extend_from_slice(&conf.to_le_bytes());
        d.extend_from_slice(&expo.to_le_bytes());
        d.extend_from_slice(&publish.to_le_bytes());
        d.extend_from_slice(&publish.to_le_bytes()); // prev_publish_time
        d.extend_from_slice(&price.to_le_bytes()); // ema_price
        d.extend_from_slice(&conf.to_le_bytes()); // ema_conf
        d.extend_from_slice(&42u64.to_le_bytes()); // posted_slot
        d.push(0); // pad to the receiver's 134-byte allocation
        d
    }

    /// sqrt_price_x64 for `usd_per_sol`, the inverse of `spot_in_price_units`.
    fn sqrt_for(usd_per_sol: f64) -> u128 {
        ((usd_per_sol / 1_000.0).sqrt() * 2f64.powi(64)) as u128
    }

    fn msg(price: i64, conf: u64, age: i64) -> PriceMsg {
        PriceMsg { price, conf, exponent: EXPO, publish_time: NOW - age }
    }

    fn err_name(r: Result<()>) -> String {
        r.unwrap_err().to_string()
    }

    #[test]
    fn parses_a_full_update() {
        let d = image(SOL_USD_FEED_ID, 1, 20_00000000, 1_000_000, EXPO, NOW);
        assert_eq!(d.len(), 134);
        assert_eq!(parse_price_update(&d).unwrap(), msg(20_00000000, 1_000_000, 0));
    }

    #[test]
    fn refuses_partial_wrong_feed_bad_discriminator_short_and_nonpositive() {
        let ok = image(SOL_USD_FEED_ID, 1, 1, 0, EXPO, NOW);
        let mut bad_disc = ok.clone();
        bad_disc[0] ^= 1;
        for d in [
            image(SOL_USD_FEED_ID, 0, 1, 0, EXPO, NOW), // Partial
            image([1u8; 32], 1, 1, 0, EXPO, NOW),        // other feed
            image(SOL_USD_FEED_ID, 1, 0, 0, EXPO, NOW),  // price 0
            image(SOL_USD_FEED_ID, 1, -5, 0, EXPO, NOW), // negative
            image(SOL_USD_FEED_ID, 1, 1, 0, 2, NOW),     // positive exponent
            bad_disc,
            ok[..132].to_vec(),
        ] {
            let e = parse_price_update(&d).unwrap_err().to_string();
            assert!(e.contains("OracleUnavailable"), "{e}");
        }
    }

    #[test]
    fn spot_conversion_matches_the_pool_formula() {
        let spot = spot_in_price_units(sqrt_for(20.0), EXPO).unwrap();
        // within 1e-6 relative of $20.00000000
        assert!(spot.abs_diff(20_00000000) < 2_000, "{spot}");
    }

    #[test]
    fn healthy_passes() {
        assert!(check_price(&msg(20_00000000, 1_000_000, 0), NOW, sqrt_for(20.0)).is_ok());
    }

    #[test]
    fn staleness_boundary() {
        let s = sqrt_for(20.0);
        assert!(check_price(&msg(20_00000000, 0, 60), NOW, s).is_ok());
        assert!(err_name(check_price(&msg(20_00000000, 0, 61), NOW, s)).contains("OracleStale"));
        // publish_time ahead of the clock is accepted (validator clocks lag).
        assert!(check_price(&msg(20_00000000, 0, -5), NOW, s).is_ok());
    }

    #[test]
    fn confidence_boundary() {
        let s = sqrt_for(20.0);
        assert!(check_price(&msg(20_00000000, 20_000_000, 0), NOW, s).is_ok(), "exactly 1%");
        let e = err_name(check_price(&msg(20_00000000, 20_000_001, 0), NOW, s));
        assert!(e.contains("OracleConfidenceTooWide"), "{e}");
    }

    #[test]
    fn deviation_boundary_both_directions() {
        let s = sqrt_for(20.0);
        let spot = spot_in_price_units(s, EXPO).unwrap() as f64;
        for (factor, ok) in [(1.0199, true), (0.9805, true), (1.0201, false), (0.9799, false)] {
            let r = check_price(&msg((spot / factor) as i64, 0, 0), NOW, s);
            assert_eq!(r.is_ok(), ok, "reference = spot / {factor}");
            if !ok {
                assert!(err_name(r).contains("OracleDeviationTooHigh"));
            }
        }
    }

    #[test]
    fn checks_run_stale_then_conf_then_deviation() {
        let far = sqrt_for(40.0);
        let e = err_name(check_price(&msg(20_00000000, u64::MAX / 2, 999), NOW, far));
        assert!(e.contains("OracleStale"), "{e}");
        let e = err_name(check_price(&msg(20_00000000, 1_000_000_000, 0), NOW, far));
        assert!(e.contains("OracleConfidenceTooWide"), "{e}");
    }

    /// Worst case is below the range: `price + conf ≤ (1 + c) / (1 − d) × spot`.
    /// Above it, `price − conf ≥ (1 − c) / (1 + d) × spot`, which is weaker.
    #[test]
    fn fx_band_covers_deviation_and_confidence() {
        let (c, d) = (MAX_CONF_BPS as f64 / 1e4, MAX_DEVIATION_BPS as f64 / 1e4);
        let band = 1.0001f64.powi(FX_BAND_TICKS);
        assert!(band > (1.0 + c) / (1.0 - d), "below-range bound");
        assert!(band > (1.0 + d) / (1.0 - c), "above-range bound");
    }

    #[test]
    fn fx_band_edges() {
        let (lo, hi) = (-40176, -38168);
        assert!(!is_exercisable(lo, hi, -39000), "in range");
        assert!(!is_exercisable(lo, hi, hi), "just out of range, inside band");
        assert!(!is_exercisable(lo, hi, hi + FX_BAND_TICKS - 1));
        assert!(is_exercisable(lo, hi, hi + FX_BAND_TICKS));
        assert!(!is_exercisable(lo, hi, lo - FX_BAND_TICKS));
        assert!(is_exercisable(lo, hi, lo - FX_BAND_TICKS - 1));
    }
}
