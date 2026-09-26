import { describe, expect, it } from "vitest";
import {
  amountsForLiquidity,
  liquidityForAmount,
  rangeComposition,
} from "../src/lib/liquidityMath";
import { formatTokenAmount } from "../src/lib/format";

// The devnet range the ticket brief names: 116.54-118.05 USDC/SOL.
const LO = -21496;
const HI = -21368;

describe("rangeComposition", () => {
  it("is all SOL above spot, all USDC below, both around it", () => {
    expect(rangeComposition(-21560, LO, HI)).toBe("sol"); // spot 115.8, range above
    expect(rangeComposition(-21368, LO, HI)).toBe("usdc"); // spot at the upper tick
    expect(rangeComposition(-21449, LO, HI)).toBe("both");
  });
});

describe("liquidityForAmount", () => {
  it("above spot: SOL buys liquidity and USDC buys none", () => {
    const L = liquidityForAmount("sol", 1_000_000_000n, -21560, LO, HI);
    expect(L).toBeGreaterThan(0n);
    expect(liquidityForAmount("usdc", 1_000_000n, -21560, LO, HI)).toBe(0n);
    const back = amountsForLiquidity(Number(L), -21560, LO, HI);
    expect(back.amountB).toBe(0);
    expect(back.amountA).toBeLessThanOrEqual(1e9);
  });

  it("below spot: USDC buys liquidity and SOL buys none", () => {
    expect(liquidityForAmount("sol", 1_000_000_000n, -21000, LO, HI)).toBe(0n);
    const L = liquidityForAmount("usdc", 50_000_000n, -21000, LO, HI);
    expect(amountsForLiquidity(Number(L), -21000, LO, HI).amountA).toBe(0);
  });

  it("in range: either side sets L, and the other side follows", () => {
    const L = liquidityForAmount("sol", 400_000_000n, -21449, LO, HI);
    const { amountA, amountB } = amountsForLiquidity(Number(L), -21449, LO, HI);
    expect(amountA).toBeLessThanOrEqual(4e8);
    expect(amountB).toBeGreaterThan(0);
    // Typing the USDC side that SOL implied gives back (about) the same L.
    const L2 = liquidityForAmount("usdc", BigInt(Math.floor(amountB)), -21449, LO, HI);
    expect(Number(L2) / Number(L)).toBeCloseTo(1, 6);
  });

  it("round trip: amount -> L -> amount never overshoots and loses < 1 ppm", () => {
    const cases: [("sol" | "usdc"), bigint, number, number, number][] = [
      ["sol", 123_456_789n, -21560, LO, HI],
      ["usdc", 98_760_000n, -21000, LO, HI],
      ["sol", 3_000_000_000n, -21449, LO, HI],
      ["usdc", 12_000_000n, -39140, -40176, -38168], // localnet demo range
    ];
    for (const [token, amount, tick, lo, hi] of cases) {
      const L = liquidityForAmount(token, amount, tick, lo, hi);
      const back = amountsForLiquidity(Number(L), tick, lo, hi);
      const got = token === "sol" ? back.amountA : back.amountB;
      expect(got).toBeLessThanOrEqual(Number(amount));
      expect((Number(amount) - got) / Number(amount)).toBeLessThan(1e-6);
    }
  });

  it("0, negative, or the token the range does not use gives L = 0 (the ticket blocks it)", () => {
    expect(liquidityForAmount("sol", 0n, -21560, LO, HI)).toBe(0n);
    expect(liquidityForAmount("sol", -5n, -21560, LO, HI)).toBe(0n);
    expect(liquidityForAmount("usdc", 5_000_000n, -21560, LO, HI)).toBe(0n);
    // One lamport already buys ~53 units of L on this 128-tick range.
    expect(liquidityForAmount("sol", 1n, -21560, LO, HI)).toBe(53n);
  });

  it("the brief's position: L = 100000 on 116.54-118.05 is dust at a ~116 spot", () => {
    const above = amountsForLiquidity(100_000, -21560, LO, HI); // spot 115.81, today
    const inside = amountsForLiquidity(100_000, -21449, LO, HI); // spot 117.09
    expect(above.amountA).toBeCloseTo(1868.6, 0); // 1868 lamports = 0.0000019 SOL
    expect(above.amountB).toBe(0);
    expect(inside.amountA).toBeCloseTo(1181.1, 0);
    expect(inside.amountB).toBeCloseTo(80.3, 0); // 80 µUSDC
    expect(formatTokenAmount(BigInt(Math.round(above.amountA)), "sol")).toBe("<0.0001 SOL");
  });
});

describe("formatTokenAmount", () => {
  it("rounds SOL to 4 and USDC to 2 decimals, and never shows dust as 0", () => {
    expect(formatTokenAmount(1_234_567_890n, "sol")).toBe("1.2345 SOL");
    expect(formatTokenAmount(52_109_999n, "usdc")).toBe("52.1 USDC");
    expect(formatTokenAmount(1n, "usdc")).toBe("<0.01 USDC");
    expect(formatTokenAmount(0n, "sol")).toBe("0 SOL");
  });
});
