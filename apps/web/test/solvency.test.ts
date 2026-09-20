import { describe, expect, it } from "vitest";
import {
  requiredMargin,
  projectedIndex,
  payableIfSettledNow,
  requiredFreeUsdc,
  canWithdraw,
  canMintLong,
  shortAccruedPremium,
  type MarketRiskFields,
} from "../src/lib/solvency";

// Deployed defaults, from state::risk_defaults / state::premium_defaults —
// see programs/perma/src/state.rs and docs/02-mvp-components/09-risk-solvency.md.
const DEFAULT_MARKET: MarketRiskFields = {
  longMarginHorizonSlots: 1_000n,
  premiumRate: 1_000_000n,
  premiumMultiplier: 1_000n,
  longMarginBufferUsdc: 1_000_000n,
};

describe("requiredMargin", () => {
  it("collapses to L + 1 USDC at the deployed defaults (09-risk-solvency.md worked example)", () => {
    expect(requiredMargin(DEFAULT_MARKET, 50_000_000n)).toBe(51_000_000n);
    expect(requiredMargin(DEFAULT_MARKET, 1n)).toBe(1_000_001n);
    expect(requiredMargin(DEFAULT_MARKET, 0n)).toBe(1_000_000n);
  });

  it("rounds UP, never down, on a non-exact division", () => {
    const m: MarketRiskFields = { ...DEFAULT_MARKET, longMarginHorizonSlots: 1n, longMarginBufferUsdc: 0n };
    // 1 * 1e6 * L * 1e3 / 1e12 == L / 1e3
    expect(requiredMargin(m, 1_000n)).toBe(1n); // exact
    expect(requiredMargin(m, 1_001n)).toBe(2n); // 1.001 -> 2
    expect(requiredMargin(m, 1n)).toBe(1n); // 0.001 -> 1, never 0
  });
});

describe("projectedIndex", () => {
  it("matches update_index's own formula: current + elapsed * rate", () => {
    const idx = { currentIndex: 1_000_000n, lastUpdateSlot: 100n };
    expect(projectedIndex(idx, 1_000_000n, 100n)).toBe(1_000_000n); // no elapsed slots
    expect(projectedIndex(idx, 1_000_000n, 200n)).toBe(1_000_000n + 100n * 1_000_000n);
  });

  it("never rewinds on a stale/earlier slot", () => {
    const idx = { currentIndex: 1_000_000n, lastUpdateSlot: 100n };
    expect(projectedIndex(idx, 1_000_000n, 50n)).toBe(1_000_000n);
  });
});

describe("payableIfSettledNow", () => {
  it("matches the V1 fixture: 100 slots, L=1e6 -> 100_000 (07-premium-engine.md)", () => {
    const pos = { accruedScaled: 0n, entryIndex: 0n, liquidity: 1_000_000n };
    // 100 slots elapsed at rate 1e6: projected = 100 * 1e6
    const payable = payableIfSettledNow(pos, 100n * 1_000_000n, 1_000n);
    expect(payable).toBe(100_000n);
  });

  it("rounds up where the on-chain settle would floor-and-carry", () => {
    const pos = { accruedScaled: 0n, entryIndex: 0n, liquidity: 1_500n };
    // 1 slot: 1e6 * 1500 * 1e3 / 1e12 == 1.5 -> settle pays 1 (carries 0.5); this ceils to 2.
    expect(payableIfSettledNow(pos, 1_000_000n, 1_000n)).toBe(2n);
  });
});

describe("requiredFreeUsdc / gates", () => {
  it("reduces to the legacy premium_owed_usdc check with no open longs", () => {
    expect(requiredFreeUsdc(400n, [], 0n, DEFAULT_MARKET)).toBe(400n);
    expect(canWithdraw(1_000n, 600n, 400n)).toBe(true);
    expect(canWithdraw(1_000n, 700n, 400n)).toBe(false);
  });

  it("matches the worked R3 example: 50e6 long, 100 slots elapsed -> requires 56 USDC", () => {
    const pos = { accruedScaled: 0n, entryIndex: 0n, liquidity: 50_000_000n };
    const projected = 100n * DEFAULT_MARKET.premiumRate;
    const required = requiredFreeUsdc(0n, [pos], projected, DEFAULT_MARKET);
    expect(required).toBe(56_000_000n); // 5_000_000 accrued + 51_000_000 margin
    expect(canWithdraw(60_000_000n, 4_000_000n, required)).toBe(true);
    expect(canWithdraw(60_000_000n, 4_000_001n, required)).toBe(false);
  });

  it("R1: a 1 µUSDC user cannot open a 1-unit long", () => {
    expect(canMintLong(1n, 0n, 1n, DEFAULT_MARKET)).toBe(false);
    expect(canMintLong(1_000_001n, 0n, 1n, DEFAULT_MARKET)).toBe(true);
  });
});

describe("shortAccruedPremium", () => {
  it("matches claim_short_amount's owed = claimable + receivable, uncapped by the pool", () => {
    // acc_premium_per_short_q64 delta of 2^64 per unit liquidity == 1 full unit owed.
    const range = { accPremiumPerShortQ64: 1n << 64n };
    const pos = { entryAccQ64: 0n, liquidity: 100_000n, premiumReceivable: 5n };
    expect(shortAccruedPremium(pos, range)).toBe(100_000n + 5n);
  });

  it("never goes negative even if entryAccQ64 is ahead of the range (should not happen, but must not crash)", () => {
    const range = { accPremiumPerShortQ64: 0n };
    const pos = { entryAccQ64: 1n << 64n, liquidity: 1n, premiumReceivable: 0n };
    expect(shortAccruedPremium(pos, range)).toBe(0n);
  });
});
