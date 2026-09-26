import { describe, expect, it } from "vitest";
import {
  isSettleable,
  SETTLE_DUST_USDC_MICRO,
  estPremiumPerHour,
  requiredMargin,
  projectedIndex,
  payableIfSettledNow,
  requiredFreeUsdc,
  canWithdraw,
  canMintLong,
  shortAccruedPremium,
  shortPayableNow,
  maxAffordableLiquidity,
  type MarketRiskFields,
} from "../src/lib/solvency";
import { rangeValueQ64 } from "../src/lib/tickMath";

// Test pricing, identical to `risk.rs`'s unit-test market: the Fair-era
// per-slot values (now the ceilings). One horizon of premium is then exactly
// the notional, so margin = ⌈notional⌉ + 1 USDC.
const DEFAULT_MARKET: MarketRiskFields = {
  longMarginHorizonSlots: 1_000n,
  premiumRate: 1_000_000n,
  premiumMultiplier: 1_000n,
  longMarginBufferUsdc: 1_000_000n,
};
// The shipped defaults (state::premium_defaults / risk_defaults, ADR-0006).
const SHIPPED: MarketRiskFields = {
  longMarginHorizonSlots: 216_000n,
  premiumRate: 11_111n,
  premiumMultiplier: 1n,
  longMarginBufferUsdc: 1_000_000n,
};
const DEMO = { tickLower: -40176, tickUpper: -38168 };
/** Largest L with at most `usdc` µUSDC of notional on the demo range (`risk.rs` `l_for`). */
const lFor = (usdc: bigint) => (usdc << 64n) / rangeValueQ64(DEMO.tickLower, DEMO.tickUpper);
const long = (liquidity: bigint) => ({ accruedScaled: 0n, entryIndex: 0n, liquidity, ...DEMO });

describe("requiredMargin", () => {
  it("is ⌈notional⌉ + 1 USDC at test pricing (risk.rs margin_at_test_pricing_is_notional_plus_buffer)", () => {
    expect(requiredMargin(DEFAULT_MARKET, lFor(50_000_000n), DEMO)).toBe(51_000_000n);
    expect(requiredMargin(DEFAULT_MARKET, 1n, DEMO)).toBe(1_000_001n);
    expect(requiredMargin(DEFAULT_MARKET, 0n, DEMO)).toBe(1_000_000n);
  });

  it("rounds UP, never down, on a non-exact division", () => {
    const m: MarketRiskFields = { ...DEFAULT_MARKET, longMarginHorizonSlots: 1n, longMarginBufferUsdc: 0n };
    expect(requiredMargin(m, lFor(1_000n), DEMO)).toBe(1n);
    expect(requiredMargin(m, lFor(1_001n), DEMO)).toBe(2n);
    expect(requiredMargin(m, 1n, DEMO)).toBe(1n); // never 0
  });

  it("is width-neutral: 50 USDC of notional costs the same margin on 32 and 2048 ticks", () => {
    const narrow = { tickLower: -39_152, tickUpper: -39_120 };
    const wide = { tickLower: -40_160, tickUpper: -38_112 };
    const l = (r: typeof narrow) => (50_000_000n << 64n) / rangeValueQ64(r.tickLower, r.tickUpper);
    expect(requiredMargin(DEFAULT_MARKET, l(narrow), narrow)).toBe(51_000_000n);
    expect(requiredMargin(DEFAULT_MARKET, l(wide), wide)).toBe(51_000_000n);
  });

  it("at the shipped defaults is ≈ 2.4 % of notional + 1 USDC", () => {
    // 120 USDC of notional: ⌈216_000 × 11_111 × 120e6 / 1e12⌉ = ⌈287_997.1⌉.
    const m = requiredMargin(SHIPPED, lFor(120_000_000n), DEMO);
    expect(m).toBe(1_000_000n + 287_998n);
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
    // 100 slots × 1e-3 × ⌈1 USDC⌉ of notional (risk.rs payable_if_settled_now_does_not_mutate).
    expect(payableIfSettledNow(long(lFor(1_000_000n)), 100n * 1_000_000n, 1_000n)).toBe(100_000n);
  });

  it("rounds up where the on-chain settle would floor-and-carry", () => {
    // 1 slot: 1e-3 × 1500 == 1.5 -> settle pays 1 (carries 0.5); this ceils to 2.
    expect(payableIfSettledNow(long(lFor(1_500n)), 1_000_000n, 1_000n)).toBe(2n);
  });
});

describe("requiredFreeUsdc / gates", () => {
  it("reduces to the legacy premium_owed_usdc check with no open longs", () => {
    expect(requiredFreeUsdc(400n, [], 0n, DEFAULT_MARKET)).toBe(400n);
    expect(canWithdraw(1_000n, 600n, 400n)).toBe(true);
    expect(canWithdraw(1_000n, 700n, 400n)).toBe(false);
  });

  it("matches the worked R3 example: 50 USDC notional, 100 slots elapsed -> requires 56 USDC", () => {
    const pos = long(lFor(50_000_000n));
    const projected = 100n * DEFAULT_MARKET.premiumRate;
    const required = requiredFreeUsdc(0n, [pos], projected, DEFAULT_MARKET);
    expect(required).toBe(56_000_000n); // 5_000_000 accrued + 51_000_000 margin
    expect(canWithdraw(60_000_000n, 4_000_000n, required)).toBe(true);
    expect(canWithdraw(60_000_000n, 4_000_001n, required)).toBe(false);
  });

  it("R1: a 1 µUSDC user cannot open a 1-unit long", () => {
    expect(canMintLong(1n, 0n, 1n, DEFAULT_MARKET, DEMO)).toBe(false);
    expect(canMintLong(1_000_001n, 0n, 1n, DEFAULT_MARKET, DEMO)).toBe(true);
  });

  it("maxAffordableLiquidity is the exact edge of canMintLong, on any range", () => {
    for (const range of [DEMO, { tickLower: -21_272, tickUpper: -21_240 }]) {
      for (const m of [DEFAULT_MARKET, SHIPPED]) {
        const free = 11_999_861n;
        const L = maxAffordableLiquidity(m, free, 0n, range);
        expect(L > 0n).toBe(true);
        expect(canMintLong(free, 0n, L, m, range)).toBe(true);
        expect(canMintLong(free, 0n, L + 1n, m, range)).toBe(false);
      }
    }
    expect(maxAffordableLiquidity(DEFAULT_MARKET, 500_000n, 0n, DEMO)).toBe(0n);
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

describe("shortPayableNow", () => {
  const pos = { entryAccQ64: 0n, liquidity: 0n, premiumReceivable: 5_000n };
  const range = { accPremiumPerShortQ64: 0n };

  it("pays nothing when the escrow is empty — NothingToSettle", () => {
    expect(shortPayableNow(pos, { ...range, premiumPool: 0n })).toBe(0n);
  });

  it("pays the carried claim when the escrow covers it, and only the escrow when it does not", () => {
    expect(shortPayableNow(pos, { ...range, premiumPool: 5_000n })).toBe(5_000n);
    expect(shortPayableNow(pos, { ...range, premiumPool: 9_000n })).toBe(5_000n);
    expect(shortPayableNow(pos, { ...range, premiumPool: 1n })).toBe(1n);
  });

  it("caps claimable + receivable by the escrow, matching claim_short_amount", () => {
    const earning = { entryAccQ64: 0n, liquidity: 100_000n, premiumReceivable: 5n };
    const acc = { accPremiumPerShortQ64: 1n << 64n };
    const owed = shortAccruedPremium(earning, acc);
    expect(owed).toBe(100_005n);
    expect(shortPayableNow(earning, { ...acc, premiumPool: 50n })).toBe(50n);
    expect(shortPayableNow(earning, { ...acc, premiumPool: owed })).toBe(owed);
  });
});

describe("estPremiumPerHour", () => {
  it("is 9000 slots of premium on notional, floored", () => {
    // Test pricing: 1e-3 of notional per slot → 9 × notional per hour.
    const market = { premiumRate: 1_000_000n, premiumMultiplier: 1_000n };
    expect(estPremiumPerHour(market, lFor(1_000_000n), DEMO)).toBe(8_999_999n);
    expect(estPremiumPerHour(market, 0n, DEMO)).toBe(0n);
    // Shipped: 0.01 % per hour → 120 USDC of notional pays 12_000 µUSDC/h (floor).
    expect(estPremiumPerHour(SHIPPED, lFor(120_000_000n), DEMO)).toBe(11_999n);
  });
});

describe("isSettleable", () => {
  it("offers Settle only from the dust floor up", () => {
    expect(isSettleable(0n)).toBe(false);
    expect(isSettleable(1n)).toBe(false);
    expect(isSettleable(999n)).toBe(false);
    expect(isSettleable(1_000n)).toBe(true);
    expect(isSettleable(1_001n)).toBe(true);
    expect(isSettleable(9_000_000n)).toBe(true);
  });

  it("keeps the floor above zero, so a settleable amount can never be hidden entirely", () => {
    expect(SETTLE_DUST_USDC_MICRO).toBeGreaterThanOrEqual(1n);
    // The floor must stay far below an hour of rent on a real position.
    // 1 SOL (~120 USDC of notional) at the shipped rate pays ~12_000 µUSDC/h.
    expect(SETTLE_DUST_USDC_MICRO).toBeLessThan(estPremiumPerHour(SHIPPED, lFor(120_000_000n), DEMO));
  });
});
