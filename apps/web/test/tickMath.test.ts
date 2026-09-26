import { describe, expect, it } from "vitest";
import {
  MAX_SQRT_PRICE_X64,
  MAX_TICK_INDEX,
  MIN_SQRT_PRICE_X64,
  MIN_TICK_INDEX,
  ORCA_EXACT_BIT_VALUES,
  forceExerciseFee,
  notionalUsdc,
  rangeValueQ64,
  scaledCharge,
  sqrtPriceX64,
} from "../src/lib/tickMath";

describe("sqrtPriceX64 (Orca port)", () => {
  it("matches Orca's exact-bit vectors on both branches", () => {
    for (const [tick, pos, neg] of ORCA_EXACT_BIT_VALUES) {
      expect(sqrtPriceX64(tick)).toBe(pos);
      expect(sqrtPriceX64(-tick)).toBe(neg);
    }
  });

  it("hits Orca's edge values and refuses ticks outside them", () => {
    expect(sqrtPriceX64(MAX_TICK_INDEX)).toBe(MAX_SQRT_PRICE_X64);
    expect(sqrtPriceX64(MIN_TICK_INDEX)).toBe(MIN_SQRT_PRICE_X64);
    expect(sqrtPriceX64(0)).toBe(1n << 64n);
    expect(() => sqrtPriceX64(MAX_TICK_INDEX + 1)).toThrow();
    expect(() => sqrtPriceX64(MIN_TICK_INDEX - 1)).toThrow();
  });

  it("is strictly increasing across the whole range", () => {
    let prev = sqrtPriceX64(MIN_TICK_INDEX);
    for (let t = MIN_TICK_INDEX + 1; t <= MAX_TICK_INDEX; t += t > -3 && t < 3 ? 1 : 97) {
      const s = sqrtPriceX64(t);
      expect(s > prev).toBe(true);
      prev = s;
    }
  });
});

describe("notional pricing (ADR-0006), parity with programs/perma", () => {
  const LO = -40176;
  const HI = -38168;
  const l50 = (50_000_000n << 64n) / rangeValueQ64(LO, HI);

  it("a long sized to 50 USDC of notional has exactly that notional, ceil'd", () => {
    expect(notionalUsdc(l50, LO, HI)).toBe(49_999_999n); // floor
    // Rust `p4_maintenance_and_boundary`: 100 slots at 1e6 × 1e3 → ⌈5 USDC⌉ projected.
    const scaled = scaledCharge(100_000_000n, 1_000n, l50, LO, HI, true);
    expect((scaled + 1_000_000_000_000n - 1n) / 1_000_000_000_000n).toBe(5_000_000n);
  });

  it("force-exercise fee is 0.1 % of notional with a 1 µUSDC floor", () => {
    expect(forceExerciseFee(l50, LO, HI)).toBe(50_000n);
    expect(forceExerciseFee(1n, LO, HI)).toBe(1n);
  });

  it("the ADR-0006 v for 128 ticks around ~120 USDC/SOL", () => {
    const perL = Number(rangeValueQ64(-21_272, -21_144)) / 2 ** 64;
    expect(perL).toBeCloseTo(0.002217, 5);
  });
});
