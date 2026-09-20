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

/** Slippage-padded `token_max_a`/`token_max_b`, as bigints, for a mint call. */
export function slippageCappedTokenMax(
  liquidity: bigint,
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  slippageBps = 100 // 1%
): { tokenMaxA: bigint; tokenMaxB: bigint } {
  const { amountA, amountB } = amountsForLiquidity(
    Number(liquidity),
    tickCurrent,
    tickLower,
    tickUpper
  );
  const factor = 1 + slippageBps / 10_000;
  return {
    tokenMaxA: BigInt(Math.ceil(amountA * factor)),
    tokenMaxB: BigInt(Math.ceil(amountB * factor)),
  };
}
