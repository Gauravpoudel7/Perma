import type { HistogramData, LineData, UTCTimestamp } from "lightweight-charts";
import type { PremiumPoint, RangeBucket } from "../../../lib/indexerApi";

/**
 * Pure mappers from indexer rows to chart rows. Nothing here interpolates,
 * smooths, or fills gaps: a point in, a point out.
 */

/**
 * The x axis is the slot, carried in the `time` slot of the row and formatted
 * as "slot N" by the chart — never a wall-clock date. Two rows can share a
 * slot (a `LongMinted` event and a poll in the same slot); the later row wins
 * because rows arrive in ingest order. `Number` is exact below 2^53; at the
 * deployed rate (1e6 per slot) the index crosses that after ~9e9 slots,
 * roughly 114 years, so display precision is not a concern for this pool.
 */
export function toPremiumLineData(points: PremiumPoint[]): LineData<UTCTimestamp>[] {
  const bySlot = new Map<number, string>();
  for (const p of points) bySlot.set(p.slot, p.indexValue);
  return Array.from(bySlot.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([slot, indexValue]) => ({ time: slot as UTCTimestamp, value: Number(BigInt(indexValue)) }));
}

export interface InventoryChartData {
  /** One entry per bucket, in x order; index i ↔ time i + 1. */
  labels: string[];
  short: HistogramData<UTCTimestamp>[];
  long: HistogramData<UTCTimestamp>[];
  /** Ordinal of the bucket equal to the ticket's range, or null when the ticket's range has no bucket. */
  selectedIndex: number | null;
}

/**
 * Each bar IS a tick range, so the ticket's range maps 1:1 onto this axis —
 * that is the only honest "range overlay" the desk has. Bars keep their
 * source order (the indexer sorts by tickLower). Liquidity is u128 on the
 * wire; the same 2^53 note as above applies.
 */
export function toInventoryHistogramData(
  buckets: RangeBucket[],
  selected: { tickLower: number; tickUpper: number },
  colors: { short: string; long: string }
): InventoryChartData {
  const labels: string[] = [];
  const short: HistogramData<UTCTimestamp>[] = [];
  const long: HistogramData<UTCTimestamp>[] = [];
  let selectedIndex: number | null = null;
  buckets.forEach((b, i) => {
    const time = (i + 1) as UTCTimestamp;
    labels.push(`[${b.tickLower}, ${b.tickUpper}]`);
    short.push({ time, value: Number(BigInt(b.shortLiquidity)), color: colors.short });
    long.push({ time, value: Number(BigInt(b.longLiquidity)), color: colors.long });
    if (b.tickLower === selected.tickLower && b.tickUpper === selected.tickUpper) selectedIndex = i;
  });
  return { labels, short, long, selectedIndex };
}
