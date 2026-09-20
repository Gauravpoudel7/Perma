/**
 * Reads the Orca Whirlpool account's spot price directly from raw bytes —
 * no Orca TS SDK dependency. Byte offsets verified this session against the
 * vendored `orca_whirlpools_client` 8.0.0 crate source
 * (generated/accounts/whirlpool.rs), not assumed:
 *
 *   0..8   discriminator
 *   8..40  whirlpools_config (Pubkey)
 *   40..41 whirlpool_bump
 *   41..43 tick_spacing (u16)
 *   43..45 fee_tier_index_seed
 *   45..47 fee_rate (u16)
 *   47..49 protocol_fee_rate (u16)
 *   49..65 liquidity (u128)
 *   65..81 sqrt_price (u128)      <-- Q64.64
 *   81..85 tick_current_index (i32)
 *
 * This is SPOT only — Orca Whirlpool has no observation array and no TWAP.
 * Any UI that reads this must label it "Spot" and never imply a time-average
 * or a historical series (ADR-0003).
 */

export interface WhirlpoolSpot {
  tickSpacing: number;
  sqrtPriceX64: bigint;
  tickCurrentIndex: number;
}

export function decodeWhirlpoolSpot(data: Buffer | Uint8Array): WhirlpoolSpot {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 85) {
    throw new Error(
      `Whirlpool account too short (${buf.length} bytes) to decode spot price.`
    );
  }
  const tickSpacing = buf.readUInt16LE(41);
  const sqrtPriceX64 = buf.readBigUInt64LE(65) | (buf.readBigUInt64LE(73) << 64n);
  const tickCurrentIndex = buf.readInt32LE(81);
  return { tickSpacing, sqrtPriceX64, tickCurrentIndex };
}

/**
 * Converts a Q64.64 sqrt-price into a human price (token B per token A),
 * adjusted for mint decimals. `sqrtPriceX64 / 2^64` is the raw sqrt price;
 * squaring it gives the raw price, then decimal-adjust.
 */
export function sqrtPriceX64ToPrice(
  sqrtPriceX64: bigint,
  decimalsA: number,
  decimalsB: number
): number {
  const Q64 = 2 ** 64;
  const sqrtPrice = Number(sqrtPriceX64) / Q64;
  const rawPrice = sqrtPrice * sqrtPrice;
  return rawPrice * 10 ** (decimalsA - decimalsB);
}

/** Price implied by a raw tick index — Orca's standard 1.0001^tick formula. */
export function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}
