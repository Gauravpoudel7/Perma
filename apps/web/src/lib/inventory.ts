/**
 * Pure helpers over `RangePremiumState`, the on-chain record of how much short
 * and long liquidity exists in one tick range. These are the numbers the Trade
 * ticket needs to answer "where can a long actually open?" — chain truth, not
 * an indexed guess, so the answer is the same with or without an indexer.
 */

export interface InventoryRange {
  tickLower: number;
  tickUpper: number;
  shortLiquidity: bigint;
  longLiquidity: bigint;
  /** What a new long could take: `short − long`, never below zero. */
  available: bigint;
}

/** Anything with a `toString()` that yields digits — Anchor hands back BN, tests hand back strings. */
type Numeric = { toString(): string };

export function toInventoryRanges(
  accounts: Array<{
    tickLower: number;
    tickUpper: number;
    totalShortLiquidity: Numeric;
    totalLongLiquidity: Numeric;
  }>
): InventoryRange[] {
  return accounts
    .map((a) => {
      const shortLiquidity = BigInt(a.totalShortLiquidity.toString());
      const longLiquidity = BigInt(a.totalLongLiquidity.toString());
      return {
        tickLower: a.tickLower,
        tickUpper: a.tickUpper,
        shortLiquidity,
        longLiquidity,
        available: shortLiquidity > longLiquidity ? shortLiquidity - longLiquidity : 0n,
      };
    })
    .sort((a, b) => a.tickLower - b.tickLower);
}

/** Distance from a range's midpoint to the current pool tick; `null` spot means "no preference". */
function distanceToTick(r: InventoryRange, currentTick: number | null): number {
  if (currentTick === null) return 0;
  return Math.abs((r.tickLower + r.tickUpper) / 2 - currentTick);
}

/**
 * Picker order: most available first, ties to whichever sits nearest the pool
 * tick, then by `tickLower` so the list never reshuffles between polls. Same
 * preference `bestAvailableRange` applies, so the top row and the "Use
 * available short" button can never disagree.
 */
export function sortRangesForPicker(
  ranges: InventoryRange[],
  currentTick: number | null
): InventoryRange[] {
  return [...ranges].sort((a, b) => {
    if (a.available !== b.available) return a.available > b.available ? -1 : 1;
    const d = distanceToTick(a, currentTick) - distanceToTick(b, currentTick);
    if (d !== 0) return d;
    return a.tickLower - b.tickLower;
  });
}

/**
 * The range a long should open against: the most available liquidity, and on a
 * tie the one whose midpoint is nearest the current pool tick. `null` when no
 * range has anything left — there is nothing to point at, and the UI says so
 * rather than picking an empty band.
 */
export function bestAvailableRange(
  ranges: InventoryRange[],
  currentTick: number | null
): InventoryRange | null {
  let best: InventoryRange | null = null;
  for (const r of ranges) {
    if (r.available <= 0n) continue;
    if (!best || r.available > best.available) {
      best = r;
      continue;
    }
    if (r.available === best.available && distanceToTick(r, currentTick) < distanceToTick(best, currentTick)) {
      best = r;
    }
  }
  return best;
}
