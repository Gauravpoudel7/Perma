//! Tick → √price and the range value `v` that prices premium (ADR-0006).
//!
//! `sqrt_price_positive_tick` / `sqrt_price_negative_tick` and their constants
//! are copied verbatim from Orca Whirlpools,
//! `programs/whirlpool/src/math/tick_math.rs` (Apache-2.0,
//! https://github.com/orca-so/whirlpools). Porting 60 lines instead of adding
//! `orca_whirlpools_core` keeps the dependency graph ADR-0001 asks for. The
//! unit tests below replay Orca's own exact-bit vectors and edge values, so a
//! transcription error cannot pass.
//!
//! [`U256`] is the one wide integer the premium math needs: `L × v` alone is
//! up to 2^52 × 2^96, past `u128`.

use anchor_lang::prelude::*;

use crate::errors::PermaError;

pub const MIN_TICK_INDEX: i32 = -443_636;
pub const MAX_TICK_INDEX: i32 = 443_636;
pub const MIN_SQRT_PRICE_X64: u128 = 4295048016;
pub const MAX_SQRT_PRICE_X64: u128 = 79226673515401279992447579055;

/// Q64.64 √price at `tick`, exactly as Orca computes it.
pub fn sqrt_price_x64(tick: i32) -> Result<u128> {
    require!(
        (MIN_TICK_INDEX..=MAX_TICK_INDEX).contains(&tick),
        PermaError::TickOutOfBounds
    );
    Ok(if tick >= 0 {
        sqrt_price_positive_tick(tick)
    } else {
        sqrt_price_negative_tick(tick)
    })
}

/// `v = √P(upper) − √P(lower)` in Q64.64: the µUSDC one unit of liquidity
/// holds once price is above the range (Orca's `amount_b` formula). Depends on
/// the ticks only, so every long and short in a range shares it.
pub fn range_value_q64(tick_lower: i32, tick_upper: i32) -> Result<u128> {
    require!(tick_lower < tick_upper, PermaError::InvalidRange);
    Ok(sqrt_price_x64(tick_upper)? - sqrt_price_x64(tick_lower)?)
}

/// `L × v` in Q64 µUSDC: the notional, kept at full precision.
pub fn notional_q64(liquidity: u128, tick_lower: i32, tick_upper: i32) -> Result<U256> {
    Ok(U256::mul(liquidity, range_value_q64(tick_lower, tick_upper)?))
}

/// `⌊L × v / 2^64⌋`: the notional in whole µUSDC.
pub fn notional_usdc(liquidity: u128, tick_lower: i32, tick_upper: i32) -> Result<u128> {
    notional_q64(liquidity, tick_lower, tick_upper)?.shr(64, false).to_u128()
}

fn mul_shift_96(n0: u128, n1: u128) -> u128 {
    // In range the product's high bits always fit; Orca unwraps here too.
    U256::mul(n0, n1).shr(96, false).to_u128().unwrap_or(u128::MAX)
}

// ---- Orca, verbatim ----------------------------------------------------------

fn sqrt_price_positive_tick(tick: i32) -> u128 {
    let mut ratio: u128 = if tick & 1 != 0 {
        79232123823359799118286999567
    } else {
        79228162514264337593543950336
    };

    if tick & 2 != 0 {
        ratio = mul_shift_96(ratio, 79236085330515764027303304731);
    }
    if tick & 4 != 0 {
        ratio = mul_shift_96(ratio, 79244008939048815603706035061);
    }
    if tick & 8 != 0 {
        ratio = mul_shift_96(ratio, 79259858533276714757314932305);
    }
    if tick & 16 != 0 {
        ratio = mul_shift_96(ratio, 79291567232598584799939703904);
    }
    if tick & 32 != 0 {
        ratio = mul_shift_96(ratio, 79355022692464371645785046466);
    }
    if tick & 64 != 0 {
        ratio = mul_shift_96(ratio, 79482085999252804386437311141);
    }
    if tick & 128 != 0 {
        ratio = mul_shift_96(ratio, 79736823300114093921829183326);
    }
    if tick & 256 != 0 {
        ratio = mul_shift_96(ratio, 80248749790819932309965073892);
    }
    if tick & 512 != 0 {
        ratio = mul_shift_96(ratio, 81282483887344747381513967011);
    }
    if tick & 1024 != 0 {
        ratio = mul_shift_96(ratio, 83390072131320151908154831281);
    }
    if tick & 2048 != 0 {
        ratio = mul_shift_96(ratio, 87770609709833776024991924138);
    }
    if tick & 4096 != 0 {
        ratio = mul_shift_96(ratio, 97234110755111693312479820773);
    }
    if tick & 8192 != 0 {
        ratio = mul_shift_96(ratio, 119332217159966728226237229890);
    }
    if tick & 16384 != 0 {
        ratio = mul_shift_96(ratio, 179736315981702064433883588727);
    }
    if tick & 32768 != 0 {
        ratio = mul_shift_96(ratio, 407748233172238350107850275304);
    }
    if tick & 65536 != 0 {
        ratio = mul_shift_96(ratio, 2098478828474011932436660412517);
    }
    if tick & 131072 != 0 {
        ratio = mul_shift_96(ratio, 55581415166113811149459800483533);
    }
    if tick & 262144 != 0 {
        ratio = mul_shift_96(ratio, 38992368544603139932233054999993551);
    }

    ratio >> 32
}

fn sqrt_price_negative_tick(tick: i32) -> u128 {
    let abs_tick = tick.abs();

    let mut ratio: u128 = if abs_tick & 1 != 0 {
        18445821805675392311
    } else {
        18446744073709551616
    };

    if abs_tick & 2 != 0 {
        ratio = (ratio * 18444899583751176498) >> 64
    }
    if abs_tick & 4 != 0 {
        ratio = (ratio * 18443055278223354162) >> 64
    }
    if abs_tick & 8 != 0 {
        ratio = (ratio * 18439367220385604838) >> 64
    }
    if abs_tick & 16 != 0 {
        ratio = (ratio * 18431993317065449817) >> 64
    }
    if abs_tick & 32 != 0 {
        ratio = (ratio * 18417254355718160513) >> 64
    }
    if abs_tick & 64 != 0 {
        ratio = (ratio * 18387811781193591352) >> 64
    }
    if abs_tick & 128 != 0 {
        ratio = (ratio * 18329067761203520168) >> 64
    }
    if abs_tick & 256 != 0 {
        ratio = (ratio * 18212142134806087854) >> 64
    }
    if abs_tick & 512 != 0 {
        ratio = (ratio * 17980523815641551639) >> 64
    }
    if abs_tick & 1024 != 0 {
        ratio = (ratio * 17526086738831147013) >> 64
    }
    if abs_tick & 2048 != 0 {
        ratio = (ratio * 16651378430235024244) >> 64
    }
    if abs_tick & 4096 != 0 {
        ratio = (ratio * 15030750278693429944) >> 64
    }
    if abs_tick & 8192 != 0 {
        ratio = (ratio * 12247334978882834399) >> 64
    }
    if abs_tick & 16384 != 0 {
        ratio = (ratio * 8131365268884726200) >> 64
    }
    if abs_tick & 32768 != 0 {
        ratio = (ratio * 3584323654723342297) >> 64
    }
    if abs_tick & 65536 != 0 {
        ratio = (ratio * 696457651847595233) >> 64
    }
    if abs_tick & 131072 != 0 {
        ratio = (ratio * 26294789957452057) >> 64
    }
    if abs_tick & 262144 != 0 {
        ratio = (ratio * 37481735321082) >> 64
    }

    ratio
}

// ---- U256 --------------------------------------------------------------------

/// Unsigned 256-bit integer, four little-endian `u64` limbs. Only the handful
/// of operations premium math needs; every one that can overflow is checked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct U256(pub [u64; 4]);

impl U256 {
    pub const ZERO: U256 = U256([0; 4]);

    pub fn from_u128(x: u128) -> U256 {
        U256([x as u64, (x >> 64) as u64, 0, 0])
    }

    /// Full 128 × 128 → 256 product (never overflows).
    pub fn mul(a: u128, b: u128) -> U256 {
        U256::from_u128(a).checked_mul_u128(b).expect("128x128 fits 256")
    }

    /// `self × b`, or `None` past 2^256.
    pub fn checked_mul_u128(self, b: u128) -> Option<U256> {
        let bl = [b as u64, (b >> 64) as u64];
        let mut out = [0u64; 6];
        for (i, &a) in self.0.iter().enumerate() {
            let mut carry: u128 = 0;
            for (j, &bj) in bl.iter().enumerate() {
                let cur = out[i + j] as u128 + (a as u128) * (bj as u128) + carry;
                out[i + j] = cur as u64;
                carry = cur >> 64;
            }
            let mut k = i + 2;
            while carry != 0 {
                let cur = out[k] as u128 + carry;
                out[k] = cur as u64;
                carry = cur >> 64;
                k += 1;
            }
        }
        if out[4] != 0 || out[5] != 0 {
            return None;
        }
        Some(U256([out[0], out[1], out[2], out[3]]))
    }

    /// `self >> bits`, rounding up when `ceil` and any shifted-out bit is set.
    pub fn shr(self, bits: u32, ceil: bool) -> U256 {
        assert!(bits < 256);
        let (limbs, rem) = ((bits / 64) as usize, bits % 64);
        let mut out = [0u64; 4];
        for (i, o) in out.iter_mut().enumerate().take(4 - limbs) {
            let lo = self.0[i + limbs] >> rem;
            let hi = if rem > 0 && i + limbs + 1 < 4 { self.0[i + limbs + 1] << (64 - rem) } else { 0 };
            *o = lo | hi;
        }
        let r = U256(out);
        if ceil && U256::lost_bits(self, bits) {
            r.checked_add_u128(1).expect("rounding cannot overflow a right shift")
        } else {
            r
        }
    }

    /// Whether `orig >> bits` dropped a set bit.
    fn lost_bits(orig: U256, bits: u32) -> bool {
        let (limbs, rem) = ((bits / 64) as usize, bits % 64);
        orig.0[..limbs].iter().any(|&l| l != 0) || (rem > 0 && orig.0[limbs] & ((1u64 << rem) - 1) != 0)
    }

    pub fn checked_add_u128(self, b: u128) -> Option<U256> {
        let add = [b as u64, (b >> 64) as u64, 0, 0];
        let mut out = [0u64; 4];
        let mut carry = 0u128;
        for i in 0..4 {
            let cur = self.0[i] as u128 + add[i] as u128 + carry;
            out[i] = cur as u64;
            carry = cur >> 64;
        }
        (carry == 0).then_some(U256(out))
    }

    /// `self / d`, rounding up when `ceil`. `d` must be non-zero.
    pub fn div_u64(self, d: u64, ceil: bool) -> U256 {
        assert!(d != 0);
        let mut out = [0u64; 4];
        let mut rem: u128 = 0;
        for i in (0..4).rev() {
            let cur = (rem << 64) | self.0[i] as u128;
            out[i] = (cur / d as u128) as u64;
            rem = cur % d as u128;
        }
        let q = U256(out);
        if ceil && rem != 0 {
            q.checked_add_u128(1).expect("a quotient below 2^256 has room for +1")
        } else {
            q
        }
    }

    pub fn to_u128(self) -> Result<u128> {
        require!(self.0[2] == 0 && self.0[3] == 0, PermaError::MathOverflow);
        Ok(self.0[0] as u128 | ((self.0[1] as u128) << 64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Orca's `test_exact_bit_values`: (tick, √P(tick), √P(−tick)).
    const EXACT_BIT_VALUES: [(i32, u128, u128); 20] = [
        (0, 18446744073709551616, 18446744073709551616), // 0x0
        (1, 18447666387855959850, 18445821805675392311), // 0x1
        (2, 18448588748116922571, 18444899583751176498), // 0x2
        (4, 18450433606991734263, 18443055278223354162), // 0x4
        (8, 18454123878217468680, 18439367220385604838), // 0x8
        (16, 18461506635090006701, 18431993317065449817), // 0x10
        (32, 18476281010653910144, 18417254355718160513), // 0x20
        (64, 18505865242158250041, 18387811781193591352), // 0x40
        (128, 18565175891880433522, 18329067761203520168), // 0x80
        (256, 18684368066214940582, 18212142134806087854), // 0x100
        (512, 18925053041275764671, 17980523815641551639), // 0x200
        (1024, 19415764168677886926, 17526086738831147013), // 0x400
        (2048, 20435687552633177494, 16651378430235024244), // 0x800
        (4096, 22639080592224303007, 15030750278693429944), // 0x1000
        (8192, 27784196929998399742, 12247334978882834399), // 0x2000
        (16384, 41848122137994986128, 8131365268884726200), // 0x4000
        (32768, 94936283578220370716, 3584323654723342297), // 0x8000
        (65536, 488590176327622479860, 696457651847595233), // 0x10000
        (131072, 12941056668319229769860, 26294789957452057), // 0x20000
        (262144, 9078618265828848800676189, 37481735321082), // 0x40000
    ];

    #[test]
    fn orca_exact_bit_values() {
        for (tick, pos, neg) in EXACT_BIT_VALUES {
            assert_eq!(sqrt_price_x64(tick).unwrap(), pos, "+{tick}");
            assert_eq!(sqrt_price_x64(-tick).unwrap(), neg, "-{tick}");
        }
    }

    #[test]
    fn orca_edges() {
        assert_eq!(sqrt_price_x64(MAX_TICK_INDEX).unwrap(), MAX_SQRT_PRICE_X64);
        assert_eq!(sqrt_price_x64(MIN_TICK_INDEX).unwrap(), MIN_SQRT_PRICE_X64);
        assert_eq!(sqrt_price_x64(0).unwrap(), 1u128 << 64);
        assert!(sqrt_price_x64(MAX_TICK_INDEX + 1).is_err());
        assert!(sqrt_price_x64(MIN_TICK_INDEX - 1).is_err());
        assert!(sqrt_price_x64(i32::MIN).is_err());
    }

    /// Strictly increasing across the whole domain, sampled every 97 ticks
    /// plus both ends (every tick would be 887k evaluations; this crosses every
    /// bit boundary of both branches).
    #[test]
    fn strictly_increasing_across_the_range() {
        let mut prev = sqrt_price_x64(MIN_TICK_INDEX).unwrap();
        let mut t = MIN_TICK_INDEX + 1;
        while t <= MAX_TICK_INDEX {
            let s = sqrt_price_x64(t).unwrap();
            assert!(s > prev, "not increasing at {t}");
            prev = s;
            t += if (-2..=2).contains(&t) || t > MAX_TICK_INDEX - 3 || t < MIN_TICK_INDEX + 3 { 1 } else { 97 };
        }
        assert!(MAX_SQRT_PRICE_X64 >= prev);
    }

    /// Within 1e-9 of 1.0001^(t/2) wherever f64 can tell.
    #[test]
    fn matches_the_closed_form() {
        for t in [-221_818, -39_140, -21_206, -8, -1, 1, 8, 21_206, 221_818] {
            let exact = 1.0001f64.powf(t as f64 / 2.0) * 2f64.powi(64);
            let got = sqrt_price_x64(t).unwrap() as f64;
            assert!(((got - exact) / exact).abs() < 1e-9, "tick {t}: {got} vs {exact}");
        }
    }

    #[test]
    fn range_value_is_orca_amount_b_per_unit() {
        // 128 ticks around the devnet spot (≈120 USDC/SOL): ≈ 0.00222 µUSDC per L.
        let v = range_value_q64(-21_272, -21_144).unwrap();
        let per_l = v as f64 / 2f64.powi(64);
        assert!((per_l - 0.002_217).abs() < 5e-6, "{per_l}");
        // 1 SOL of value on it is ≈ 120 USDC of notional.
        let n = notional_usdc(54_209_780_885, -21_272, -21_144).unwrap();
        assert!((119_000_000..121_000_000).contains(&n), "{n}");
        assert!(range_value_q64(-8, -8).is_err());
        // The widest possible range still fits u128.
        assert!(range_value_q64(MIN_TICK_INDEX, MAX_TICK_INDEX).is_ok());
    }

    #[test]
    fn u256_mul_shift_div_and_overflow() {
        // Small values agree with u128.
        let p = U256::mul(123_456_789, 987_654_321);
        assert_eq!(p.to_u128().unwrap(), 123_456_789u128 * 987_654_321);
        // 2^127 × 2^127 = 2^254: fits 256, not 128.
        let big = U256::mul(1u128 << 127, 1u128 << 127);
        assert_eq!(big.0, [0, 0, 0, 1u64 << 62]);
        assert!(big.to_u128().is_err());
        assert_eq!(big.shr(254, false).to_u128().unwrap(), 1);
        // × 4 more overflows 256 bits.
        assert!(big.checked_mul_u128(4).is_none());
        assert!(big.checked_mul_u128(3).is_some());
        // u128::MAX² is the largest 128x128 product.
        let m = U256::mul(u128::MAX, u128::MAX);
        assert_eq!(m.0, [1, 0, u64::MAX - 1, u64::MAX]);
        // Shifts round up only when a bit is lost.
        assert_eq!(U256::from_u128(8).shr(2, true).to_u128().unwrap(), 2);
        assert_eq!(U256::from_u128(9).shr(2, true).to_u128().unwrap(), 3);
        assert_eq!(U256::from_u128(9).shr(2, false).to_u128().unwrap(), 2);
        assert_eq!(U256::mul(1u128 << 100, 3).shr(64, true).to_u128().unwrap(), 3u128 << 36);
        // Division.
        assert_eq!(U256::from_u128(10).div_u64(3, false).to_u128().unwrap(), 3);
        assert_eq!(U256::from_u128(10).div_u64(3, true).to_u128().unwrap(), 4);
        assert_eq!(U256::from_u128(9).div_u64(3, true).to_u128().unwrap(), 3);
        assert_eq!(m.div_u64(u64::MAX, false).shr(128, false).to_u128().unwrap(), 1u128 << 64);
        // Adding past 2^256 is refused.
        assert!(U256([u64::MAX; 4]).checked_add_u128(1).is_none());
    }
}
