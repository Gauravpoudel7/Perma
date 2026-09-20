import { describe, expect, it } from "vitest";
import { decodeWhirlpoolSpot, sqrtPriceX64ToPrice, tickToPrice } from "../src/lib/whirlpool";

describe("decodeWhirlpoolSpot", () => {
  it("reads tick_spacing, sqrt_price, and tick_current_index at the verified byte offsets", () => {
    const buf = Buffer.alloc(85);
    buf.writeUInt16LE(8, 41); // tick_spacing
    // sqrt_price at 65..81 (u128 LE): set the low 8 bytes to a known value.
    buf.writeBigUInt64LE(123456789n, 65);
    buf.writeBigUInt64LE(0n, 73);
    buf.writeInt32LE(-40176, 81); // tick_current_index

    const spot = decodeWhirlpoolSpot(buf);
    expect(spot.tickSpacing).toBe(8);
    expect(spot.sqrtPriceX64).toBe(123456789n);
    expect(spot.tickCurrentIndex).toBe(-40176);
  });

  it("throws rather than silently misreading a too-short buffer", () => {
    expect(() => decodeWhirlpoolSpot(Buffer.alloc(10))).toThrow();
  });
});

describe("sqrtPriceX64ToPrice / tickToPrice", () => {
  it("sqrtPriceX64ToPrice(2^64, ...) is 1.0 before decimal adjustment", () => {
    const price = sqrtPriceX64ToPrice(2n ** 64n, 0, 0);
    expect(price).toBeCloseTo(1.0, 10);
  });

  it("tickToPrice(0, ...) is 1.0 before decimal adjustment", () => {
    expect(tickToPrice(0, 0, 0)).toBeCloseTo(1.0, 10);
  });

  it("tickToPrice is monotonically increasing with tick", () => {
    expect(tickToPrice(100, 9, 6)).toBeGreaterThan(tickToPrice(0, 9, 6));
  });
});
