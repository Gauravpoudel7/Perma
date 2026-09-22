import { describe, expect, it } from "vitest";
import { bestAvailableRange, sortRangesForPicker, toInventoryRanges } from "../src/lib/inventory";

// Stand-ins for Anchor's BN: anything with a digit-producing toString().
const raw = (tickLower: number, tickUpper: number, short: string, long: string) => ({
  tickLower,
  tickUpper,
  totalShortLiquidity: { toString: () => short },
  totalLongLiquidity: { toString: () => long },
});

describe("toInventoryRanges", () => {
  it("sorts by tickLower, keeps u128 precision, and floors available at zero", () => {
    const ranges = toInventoryRanges([
      raw(0, 8, "100", "40"),
      raw(-40176, -38168, "340282366920938463463374607431768211455", "1"),
      // A long can never exceed its range's short on-chain; if a read ever says
      // otherwise, show 0 rather than a negative "available".
      raw(-16, -8, "5", "9"),
    ]);
    expect(ranges.map((r) => r.tickLower)).toEqual([-40176, -16, 0]);
    expect(ranges[0]?.available).toBe(340282366920938463463374607431768211454n);
    expect(ranges[1]?.available).toBe(0n);
    expect(ranges[2]?.available).toBe(60n);
  });
});

describe("bestAvailableRange", () => {
  const ranges = toInventoryRanges([
    raw(-100, -50, "100", "0"),
    raw(0, 50, "100", "0"),
    raw(200, 250, "10", "0"),
  ]);

  it("prefers the most available, breaking ties by nearness to spot", () => {
    expect(bestAvailableRange(ranges, 40)?.tickLower).toBe(0);
    expect(bestAvailableRange(ranges, -80)?.tickLower).toBe(-100);
  });

  it("returns null when nothing is available", () => {
    expect(bestAvailableRange(toInventoryRanges([raw(0, 8, "7", "7")]), 0)).toBeNull();
    expect(bestAvailableRange([], 0)).toBeNull();
  });
});

describe("sortRangesForPicker", () => {
  it("puts the most available first, then the nearest to spot, then a stable tick order", () => {
    const ranges = toInventoryRanges([
      raw(400, 450, "50", "0"),   // available 50, far from spot
      raw(0, 50, "100", "40"),    // available 60
      raw(-100, -50, "60", "0"),  // available 60, ties with the one above
      raw(800, 850, "10", "10"),  // available 0
    ]);
    // spot 20 sits inside [0, 50], so that range wins the 60-vs-60 tie.
    const sorted = sortRangesForPicker(ranges, 20);
    expect(sorted.map((r) => r.tickLower)).toEqual([0, -100, 400, 800]);
    // Same input, spot near the other range: the tie flips, the rest holds.
    expect(sortRangesForPicker(ranges, -75).map((r) => r.tickLower)).toEqual([-100, 0, 400, 800]);
  });

  it("is deterministic on a full tie and does not mutate its input", () => {
    const ranges = toInventoryRanges([raw(8, 16, "10", "0"), raw(0, 8, "10", "0")]);
    const before = ranges.map((r) => r.tickLower);
    expect(sortRangesForPicker(ranges, null).map((r) => r.tickLower)).toEqual([0, 8]);
    expect(ranges.map((r) => r.tickLower)).toEqual(before);
  });
});
