import { describe, expect, it } from "vitest";
import { cleanAmountInput, ticketSize, vaultShortfall } from "../src/lib/ticketSize";
import { amountsForLiquidity, slippageCappedTokenMax } from "../src/lib/liquidityMath";
import { parseToBaseUnits } from "../src/lib/format";
import { canMintLong, maxAffordableLiquidity, requiredMargin } from "../src/lib/solvency";

const LO = -21496;
const HI = -21368;

describe("ticketSize", () => {
  it("sends the L the ticket shows: amounts are what that exact L uses", () => {
    const s = ticketSize({ input: "0.25", inputToken: "sol", tickCurrent: -21560, tickLower: LO, tickUpper: HI });
    expect(s.composition).toBe("sol");
    expect(s.liquidity).not.toBeNull();
    const back = amountsForLiquidity(Number(s.liquidity), -21560, LO, HI);
    expect(s.amountA).toBe(BigInt(Math.ceil(back.amountA)));
    expect(s.amountA).toBeLessThanOrEqual(250_000_000n);
  });

  it("never re-reads a SOL amount as USDC when the range lands below spot", () => {
    const s = ticketSize({ input: "0.25", inputToken: "sol", tickCurrent: -21000, tickLower: LO, tickUpper: HI });
    expect(s.token).toBe("usdc");
    expect(s.liquidity).toBeNull();
    expect(s.error).toBeNull();
  });

  it("empty, zero and garbage input send nothing", () => {
    for (const input of ["", "0", "0.000", "."]) {
      expect(ticketSize({ input, inputToken: "sol", tickCurrent: -21560, tickLower: LO, tickUpper: HI }).liquidity).toBeNull();
    }
  });

  it("recomputes when spot moves inside a mixed range", () => {
    const at = (tick: number) =>
      ticketSize({ input: "0.4", inputToken: "sol", tickCurrent: tick, tickLower: LO, tickUpper: HI });
    expect(at(-21449).liquidity).not.toEqual(at(-21420).liquidity);
  });
});

describe("cleanAmountInput and parseToBaseUnits", () => {
  it("keeps digits and one dot, capped at the token's decimals", () => {
    expect(cleanAmountInput("1a.2.3", "usdc")).toBe("1.23");
    expect(cleanAmountInput("0.1234567891", "sol")).toBe("0.123456789");
    expect(cleanAmountInput("12,5", "sol")).toBe("125");
  });
  it("parseToBaseUnits never throws on text a user can type (it runs during render)", () => {
    expect(parseToBaseUnits("1a", 6)).toBe(0n);
    expect(parseToBaseUnits("1.2.3", 6)).toBe(0n);
    expect(parseToBaseUnits("1.5", 6)).toBe(1_500_000n);
  });
});

describe("vaultShortfall", () => {
  it("names exactly what the vault is missing for a short's caps", () => {
    const caps = slippageCappedTokenMax(1_000_000_000_000n, -21449, LO, HI);
    expect(vaultShortfall(caps, { a: caps.tokenMaxA, b: caps.tokenMaxB })).toBeNull();
    expect(vaultShortfall(caps, { a: 0n, b: caps.tokenMaxB })).toMatch(/^Your vault needs [\d.]+ SOL more for this short\.$/);
    expect(vaultShortfall(caps, { a: 0n, b: 0n })).toMatch(/SOL and [\d.]+ USDC more/);
  });
});

describe("maxAffordableLiquidity", () => {
  it("is the exact edge of canMintLong at the shipped defaults, on the ticket's range", () => {
    const m = { longMarginHorizonSlots: 216_000n, premiumRate: 11_111n, premiumMultiplier: 1n, longMarginBufferUsdc: 1_000_000n };
    const range = { tickLower: LO, tickUpper: HI };
    const free = 11_999_861n; // the test wallet's vault
    const L = maxAffordableLiquidity(m, free, 0n, range);
    expect(canMintLong(free, 0n, L, m, range)).toBe(true);
    expect(canMintLong(free, 0n, L + 1n, m, range)).toBe(false);
    expect(requiredMargin(m, L, range) <= free).toBe(true);
    expect(maxAffordableLiquidity(m, 500_000n, 0n, range)).toBe(0n);
  });
});
