import { describe, expect, it } from "vitest";
import { toInventoryHistogramData, toPremiumLineData } from "../src/components/trade/charts/series";

// Synthetic rows for the mappers only. Nothing in src/ imports this file, and
// no product path can render these numbers.
const FAKE_POINTS = [
  { slot: 30, blockTime: null, indexValue: "300", source: "poll" as const },
  { slot: 10, blockTime: null, indexValue: "100", source: "event" as const },
  { slot: 30, blockTime: null, indexValue: "301", source: "event" as const },
  { slot: 20, blockTime: null, indexValue: "200", source: "poll" as const },
];

describe("toPremiumLineData", () => {
  it("sorts by slot, keeps the last row per slot, and never adds a point", () => {
    const rows = toPremiumLineData(FAKE_POINTS);
    expect(rows.map((r) => r.time)).toEqual([10, 20, 30]);
    expect(rows.map((r) => r.value)).toEqual([100, 200, 301]);
  });

  it("carries u128 strings through BigInt, not parseFloat", () => {
    const [row] = toPremiumLineData([{ slot: 1, blockTime: null, indexValue: "9007199254740992", source: "poll" }]);
    expect(row?.value).toBe(9007199254740992);
  });
});

describe("toInventoryHistogramData", () => {
  const buckets = [
    { tickLower: -100, tickUpper: -50, shortLiquidity: "500", longLiquidity: "20" },
    { tickLower: -50, tickUpper: 0, shortLiquidity: "0", longLiquidity: "0" },
  ];
  const colors = { short: "muted", long: "primary" };

  it("maps buckets to ordinal bars and finds the ticket's range", () => {
    const d = toInventoryHistogramData(buckets, { tickLower: -50, tickUpper: 0 }, colors);
    expect(d.labels).toEqual(["[-100, -50]", "[-50, 0]"]);
    expect(d.short.map((b) => [b.time, b.value])).toEqual([
      [1, 500],
      [2, 0],
    ]);
    expect(d.long[0]?.color).toBe("primary");
    expect(d.selectedIndex).toBe(1);
  });

  it("marks nothing when the ticket's range has no bucket", () => {
    expect(toInventoryHistogramData(buckets, { tickLower: 8, tickUpper: 16 }, colors).selectedIndex).toBeNull();
  });
});
