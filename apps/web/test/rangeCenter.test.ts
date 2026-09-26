import { describe, expect, it } from "vitest";
import { centeredRange, isFarFromSpot } from "../src/lib/rangeCenter";

describe("isFarFromSpot", () => {
  it("flags the localnet demo range on a devnet spot of ~116", () => {
    expect(isFarFromSpot(-40176, -38168, -21560)).toBe(true);
  });
  it("does not flag a range around spot, or one just beside it", () => {
    expect(isFarFromSpot(-40176, -38168, -39140)).toBe(false); // localnet: spot inside
    expect(isFarFromSpot(-21496, -21368, -21560)).toBe(false); // 64 ticks below a 128-wide range
    expect(isFarFromSpot(-21496, -21368, -21300)).toBe(false);
  });
  it("flags spot more than one width away on either side", () => {
    expect(isFarFromSpot(-21496, -21368, -21625)).toBe(true);
    expect(isFarFromSpot(-21496, -21368, -21240)).toBe(true);
  });
});

describe("centeredRange", () => {
  it("snaps to the tick spacing and opens ±32 spacings", () => {
    expect(centeredRange(-21560, 8)).toEqual([-21816, -21304]);
    expect(centeredRange(-21563, 8)).toEqual([-21824, -21312]);
    const [lo, hi] = centeredRange(-21563, 8);
    expect(Math.abs(lo % 8)).toBe(0);
    expect(Math.abs(hi % 8)).toBe(0);
    expect(lo <= -21563 && -21563 < hi).toBe(true);
  });
});
