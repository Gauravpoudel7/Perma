/**
 * Uniswap-V3-style liquidity <-> token-amount math (Orca Whirlpool uses the
 * same virtual-reserves formula). PERMA does not quote this on-chain — per
 * `01-clmm-adapter-orca.md`, the client supplies `token_max_a`/`token_max_b`
 * as slippage caps, and the program measures the OBSERVED vault delta after
 * the real CPI. This module exists only to give the UI a real, honest
 * slippage cap to submit — not to predict the exact fill, which the CPI
 * itself is the only authority on.
 *
 * Floating-point is intentionally used here (never on-chain): this is a UI
 * estimate with a slippage buffer applied on top, not a settlement figure.
 */

import { sqrtPriceX64 as sqrtPriceX64AtTick } from "./tickMath";

function sqrtPriceAtTick(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

export interface LiquidityAmounts {
  amountA: number;
  amountB: number;
}

/**
 * Token amounts required for `liquidity` across [tickLower, tickUpper] at
 * the pool's current tick. Below the range: all token A. Above: all token B.
 * Inside: a mix, per the standard concentrated-liquidity formula.
 */
export function amountsForLiquidity(
  liquidity: number,
  tickCurrent: number,
  tickLower: number,
  tickUpper: number
): LiquidityAmounts {
  const sqrtCurrent = sqrtPriceAtTick(tickCurrent);
  const sqrtLower = sqrtPriceAtTick(tickLower);
  const sqrtUpper = sqrtPriceAtTick(tickUpper);

  if (tickCurrent < tickLower) {
    return { amountA: liquidity * (1 / sqrtLower - 1 / sqrtUpper), amountB: 0 };
  }
  if (tickCurrent >= tickUpper) {
    return { amountA: 0, amountB: liquidity * (sqrtUpper - sqrtLower) };
  }
  return {
    amountA: liquidity * (1 / sqrtCurrent - 1 / sqrtUpper),
    amountB: liquidity * (sqrtCurrent - sqrtLower),
  };
}

/**
 * Exactly what Orca's `increase_liquidity` takes for `liquidity` at the pool's
 * actual √price (`get_amount_delta_a/b`, rounded up), in base units. Integer
 * math from the same tick table as the program (`tickMath.ts`), not the float
 * estimate above: a whole-tick float under-counts the near side by up to
 * 1 / (ticks from spot to the range edge), which on a narrow range exceeds any
 * sensible slippage buffer.
 */
export function exactDepositAmounts(
  liquidity: bigint,
  sqrtPriceX64: bigint,
  tickLower: number,
  tickUpper: number
): { amountA: bigint; amountB: bigint } {
  const lo = sqrtPriceX64AtTick(tickLower);
  const hi = sqrtPriceX64AtTick(tickUpper);
  const p = sqrtPriceX64 < lo ? lo : sqrtPriceX64 > hi ? hi : sqrtPriceX64;
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
  const amountA = p < hi ? ceilDiv((liquidity << 64n) * (hi - p), hi * p) : 0n;
  const amountB = p > lo ? ceilDiv(liquidity * (p - lo), 1n << 64n) : 0n;
  return { amountA, amountB };
}

/** Slippage-padded `token_max_a`/`token_max_b` for a mint call, from the exact amounts. */
export function slippageCappedTokenMax(
  liquidity: bigint,
  sqrtPriceX64: bigint,
  tickLower: number,
  tickUpper: number,
  slippageBps = 100 // 1%
): { tokenMaxA: bigint; tokenMaxB: bigint } {
  const { amountA, amountB } = exactDepositAmounts(liquidity, sqrtPriceX64, tickLower, tickUpper);
  const pad = (x: bigint) => (x * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
  return { tokenMaxA: pad(amountA), tokenMaxB: pad(amountB) };
}

// --- Size in tokens (the ticket's input) ------------------------------------
//
// The inverse of `amountsForLiquidity`: the trader types a token amount, the
// ticket sends the liquidity `L` that uses at most that much. Same float
// estimate, same caveat: Orca's CPI decides the real fill, and the mint's
// `token_max_*` caps (above) bound it.

export type TokenSide = "sol" | "usdc";

/** Which tokens a range holds at the current tick: SOL above spot, USDC below, both around it. */
export function rangeComposition(tickCurrent: number, tickLower: number, tickUpper: number): TokenSide | "both" {
  if (tickCurrent < tickLower) return "sol";
  if (tickCurrent >= tickUpper) return "usdc";
  return "both";
}

/**
 * Largest `L` whose `amountsForLiquidity` needs no more than `amount` base
 * units of `token`. 0n when the token plays no part in this range at this tick
 * (e.g. USDC for a range entirely above spot), or when the amount is too small
 * to buy one unit of liquidity.
 */
export function liquidityForAmount(
  token: TokenSide,
  amount: bigint,
  tickCurrent: number,
  tickLower: number,
  tickUpper: number
): bigint {
  if (amount <= 0n) return 0n;
  const composition = rangeComposition(tickCurrent, tickLower, tickUpper);
  if (composition !== "both" && composition !== token) return 0n;
  const sqrtLower = sqrtPriceAtTick(tickLower);
  const sqrtUpper = sqrtPriceAtTick(tickUpper);
  const sqrtCurrent = sqrtPriceAtTick(Math.min(Math.max(tickCurrent, tickLower), tickUpper));
  const perUnit =
    token === "sol"
      ? 1 / (composition === "both" ? sqrtCurrent : sqrtLower) - 1 / sqrtUpper
      : (composition === "both" ? sqrtCurrent : sqrtUpper) - sqrtLower;
  if (!(perUnit > 0)) return 0n;
  // Floor, then step back while float error would make the round trip overshoot.
  let L = BigInt(Math.floor(Number(amount) / perUnit));
  while (L > 0n) {
    const back = amountsForLiquidity(Number(L), tickCurrent, tickLower, tickUpper);
    if ((token === "sol" ? back.amountA : back.amountB) <= Number(amount)) break;
    L -= 1n;
  }
  return L;
}

/** What `liquidity` stands for at `tickCurrent`, floored to base units. Portfolio shows positions with it. */
export function positionAmounts(liquidity: bigint, tickCurrent: number, tickLower: number, tickUpper: number) {
  const { amountA, amountB } = amountsForLiquidity(Number(liquidity), tickCurrent, tickLower, tickUpper);
  return { amountA: BigInt(Math.floor(amountA)), amountB: BigInt(Math.floor(amountB)) };
}
