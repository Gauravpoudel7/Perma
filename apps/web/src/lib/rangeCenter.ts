/**
 * Where the ticket's range sits relative to spot. Pure, so the Trade screen's
 * "far from spot" warning and its auto-centre share one rule.
 */

/** Half-width, in tick spacings, of the range "Re-center on spot" opens. Same as the ±32 preset. */
export const RECENTER_SPACINGS = 32;

/** True when spot is more than one range-width outside [tickLower, tickUpper). */
export function isFarFromSpot(tickLower: number, tickUpper: number, spotTick: number): boolean {
  const width = tickUpper - tickLower;
  return spotTick < tickLower - width || spotTick >= tickUpper + width;
}

/** ±`n` spacings around spot, snapped to the pool's tick spacing. */
export function centeredRange(spotTick: number, tickSpacing: number, n = RECENTER_SPACINGS): [number, number] {
  const center = Math.floor(spotTick / tickSpacing) * tickSpacing;
  return [center - n * tickSpacing, center + n * tickSpacing];
}
