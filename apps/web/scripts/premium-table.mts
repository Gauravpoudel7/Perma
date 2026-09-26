// ADR-0006 measurement: what longs cost before (per unit of Orca liquidity L)
// and after (per unit of notional L·v), using the app's own pricing functions,
// which mirror programs/perma exactly. Read-only: it fetches the pool from
// Solana-devnet to print the live spot, and sends nothing. The RPC URL is read
// from .env.local and never printed.
//
//   cd apps/web && npx tsx scripts/premium-table.mts
import { readFileSync } from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { amountsForLiquidity } from "../src/lib/liquidityMath";
import { estPremiumPerHour, requiredMargin, type MarketRiskFields } from "../src/lib/solvency";
import { forceExerciseFee, MIN_RANGE_TICKS, notionalUsdc, PREMIUM_SCALE } from "../src/lib/tickMath";
import { tickToPrice } from "../src/lib/whirlpool";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i)] ??= line.slice(i + 1).replace(/^"|"$/g, "");
}
const WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const live = await new Connection(process.env.NEXT_PUBLIC_RPC_URL!, "confirmed").getAccountInfo(WHIRLPOOL);

const SPOT_TICK = -21206; // fixed for reproducible tables, ≈ 119.97 USDC/SOL
const SPACING = 8;
const P = tickToPrice(SPOT_TICK, 9, 6);
console.log(`live spot tick ${live?.data.readInt32LE(81) ?? "?"}; tables use tick ${SPOT_TICK} = ${P.toFixed(2)} USDC/SOL`);

/** Fair MVP (before ADR-0006): premium per unit of L. */
const LEGACY = { rate: 1_000_000n, mult: 1_000n, horizon: 1_000n, buffer: 1_000_000n };
const legacyPerHour = (L: bigint) => (LEGACY.rate * L * LEGACY.mult * 9_000n) / PREMIUM_SCALE;
const legacyMargin = (L: bigint) => {
  const x = LEGACY.horizon * LEGACY.rate * L * LEGACY.mult;
  return (x + PREMIUM_SCALE - 1n) / PREMIUM_SCALE + LEGACY.buffer;
};
/** Shipped by ADR-0006. */
const SHIPPED: MarketRiskFields = {
  longMarginHorizonSlots: 216_000n,
  premiumRate: 11_111n,
  premiumMultiplier: 1n,
  longMarginBufferUsdc: 1_000_000n,
};

const usdc = (x: bigint) => Number(x) / 1e6;
const fmt = (x: number) => (x >= 1e5 ? x.toExponential(2) : x >= 100 ? x.toFixed(0) : x >= 0.01 ? x.toFixed(4) : x.toExponential(2));
const center = Math.floor(SPOT_TICK / SPACING) * SPACING;
const centred = (w: number): [number, number] => [center - w / 2, center + w / 2];
/** L whose tokens at spot are worth `usd` USDC. */
const liquidityWorth = (usd: number, lo: number, hi: number) => {
  const per = amountsForLiquidity(1, SPOT_TICK, lo, hi);
  return BigInt(Math.floor(usd / ((per.amountA / 1e9) * P + per.amountB / 1e6)));
};

const rows: Record<string, string>[] = [];
for (const w of [8, 32, 128, 512, 2048]) {
  const [lo, hi] = centred(w);
  for (const sol of [0.001, 0.1, 1]) {
    const usd = sol * P;
    const L = liquidityWorth(usd, lo, hi);
    const range = { tickLower: lo, tickUpper: hi };
    const refused = w < MIN_RANGE_TICKS;
    rows.push({
      width: `${w} (${tickToPrice(lo, 9, 6).toFixed(2)}–${tickToPrice(hi, 9, 6).toFixed(2)})`,
      size: `${sol} SOL`,
      "value USDC": usd.toFixed(3),
      "before: prem/h": fmt(usdc(legacyPerHour(L))),
      "before: margin": fmt(usdc(legacyMargin(L))),
      "after: prem/h": refused ? "refused (< 32 ticks)" : fmt(usdc(estPremiumPerHour(SHIPPED, L, range))),
      "after: margin": refused ? "—" : fmt(usdc(requiredMargin(SHIPPED, L, range))),
      "after: FX fee": refused ? "—" : fmt(usdc(forceExerciseFee(L, lo, hi))),
    });
  }
}
console.log("\n## Before (per L) vs after (per notional, 0.01 %/h, 1-day margin)");
console.table(rows);

// v·L prices a range at the top of its range. How far is that from its value at spot?
const ratio: Record<string, string>[] = [];
for (const side of ["above", "below"] as const) {
  for (const pct of [5, 10, 20]) {
    for (const w of [128, 2048]) {
      const edge = Math.round(Math.log(1 + (side === "above" ? pct : -pct) / 100) / Math.log(1.0001) / SPACING) * SPACING;
      const [lo, hi] = side === "above" ? [SPOT_TICK + edge, SPOT_TICK + edge + w] : [SPOT_TICK + edge - w, SPOT_TICK + edge];
      const [l, h] = [Math.floor(lo / SPACING) * SPACING, Math.floor(hi / SPACING) * SPACING];
      const L = 10n ** 12n;
      const per = amountsForLiquidity(Number(L), SPOT_TICK, l, h);
      const value = (per.amountA / 1e9) * P + per.amountB / 1e6;
      ratio.push({
        range: `${pct}% ${side} spot, ${w} ticks`,
        prices: `${tickToPrice(l, 9, 6).toFixed(2)}–${tickToPrice(h, 9, 6).toFixed(2)}`,
        "v·L ÷ value at spot": (usdc(notionalUsdc(L, l, h)) / value).toFixed(4),
      });
    }
  }
}
console.log("\n## v·L ÷ value at spot, for ranges away from spot");
console.table(ratio);
