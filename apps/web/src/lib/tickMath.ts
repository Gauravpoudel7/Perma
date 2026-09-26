/**
 * Tick → √price and the notional that prices premium and margin (ADR-0006).
 *
 * A bigint mirror of `programs/perma/src/tick_math.rs`, which ports Orca
 * Whirlpools' `sqrt_price_from_tick_index` (Apache-2.0). The constants below
 * are generated from that Rust file, and `test/tickMath.test.ts` replays
 * Orca's exact-bit vectors, so the UI and the program compute the same
 * integers. bigint is exact, so every Rust `U256` step is a plain operation
 * here; only the rounding (floor / ceil) has to match.
 */

export const MIN_TICK_INDEX = -443_636;
export const MAX_TICK_INDEX = 443_636;
export const MIN_SQRT_PRICE_X64 = 4295048016n;
export const MAX_SQRT_PRICE_X64 = 79226673515401279992447579055n;
/** `premium::PREMIUM_SCALE`. */
export const PREMIUM_SCALE = 1_000_000_000_000n;
/** `risk::MIN_RANGE_TICKS`: no new long or short on a narrower range. */
export const MIN_RANGE_TICKS = 32;
/** `risk::FX_FEE_BPS`: force-exercise fee, bps of notional. */
export const FX_FEE_BPS = 10n;

const Q64 = 1n << 64n;
const POS: [number, bigint][] = [
  [2, 79236085330515764027303304731n],
  [4, 79244008939048815603706035061n],
  [8, 79259858533276714757314932305n],
  [16, 79291567232598584799939703904n],
  [32, 79355022692464371645785046466n],
  [64, 79482085999252804386437311141n],
  [128, 79736823300114093921829183326n],
  [256, 80248749790819932309965073892n],
  [512, 81282483887344747381513967011n],
  [1024, 83390072131320151908154831281n],
  [2048, 87770609709833776024991924138n],
  [4096, 97234110755111693312479820773n],
  [8192, 119332217159966728226237229890n],
  [16384, 179736315981702064433883588727n],
  [32768, 407748233172238350107850275304n],
  [65536, 2098478828474011932436660412517n],
  [131072, 55581415166113811149459800483533n],
  [262144, 38992368544603139932233054999993551n],
];
const NEG: [number, bigint][] = [
  [2, 18444899583751176498n],
  [4, 18443055278223354162n],
  [8, 18439367220385604838n],
  [16, 18431993317065449817n],
  [32, 18417254355718160513n],
  [64, 18387811781193591352n],
  [128, 18329067761203520168n],
  [256, 18212142134806087854n],
  [512, 17980523815641551639n],
  [1024, 17526086738831147013n],
  [2048, 16651378430235024244n],
  [4096, 15030750278693429944n],
  [8192, 12247334978882834399n],
  [16384, 8131365268884726200n],
  [32768, 3584323654723342297n],
  [65536, 696457651847595233n],
  [131072, 26294789957452057n],
  [262144, 37481735321082n],
];

/** Q64.64 √price at `tick`, exactly as Orca (and the program) compute it. */
export function sqrtPriceX64(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK_INDEX || tick > MAX_TICK_INDEX) {
    throw new Error(`tick ${tick} is out of bounds`);
  }
  if (tick >= 0) {
    let ratio = tick & 1 ? 79232123823359799118286999567n : 79228162514264337593543950336n;
    for (const [bit, c] of POS) if (tick & bit) ratio = (ratio * c) >> 96n;
    return ratio >> 32n;
  }
  const abs = -tick;
  let ratio = abs & 1 ? 18445821805675392311n : 18446744073709551616n;
  for (const [bit, c] of NEG) if (abs & bit) ratio = (ratio * c) >> 64n;
  return ratio;
}

/** `v = √P(upper) − √P(lower)`, Q64: µUSDC one unit of liquidity holds at the top of its range. */
export function rangeValueQ64(tickLower: number, tickUpper: number): bigint {
  if (!(tickLower < tickUpper)) throw new Error("tickLower must be below tickUpper");
  return sqrtPriceX64(tickUpper) - sqrtPriceX64(tickLower);
}

/** `L × v` in Q64 µUSDC (full precision). */
export function notionalQ64(liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  return liquidity * rangeValueQ64(tickLower, tickUpper);
}

/** `⌊L × v / 2^64⌋`: the notional in whole µUSDC. */
export function notionalUsdc(liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  return notionalQ64(liquidity, tickLower, tickUpper) >> 64n;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** `premium::scaled_charge`: what `liquidity` owes over `dIndex`, in scaled units. */
export function scaledCharge(
  dIndex: bigint,
  premiumMultiplier: bigint,
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  ceil: boolean
): bigint {
  if (dIndex === 0n || liquidity === 0n) return 0n;
  const x = notionalQ64(liquidity, tickLower, tickUpper) * dIndex * premiumMultiplier;
  return ceil ? ceilDiv(x, Q64) : x / Q64;
}

/** `risk::force_exercise_fee`: `max(1, ⌈notional × FX_FEE_BPS / 10_000⌉)` µUSDC. */
export function forceExerciseFee(liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  const fee = ceilDiv(ceilDiv(notionalQ64(liquidity, tickLower, tickUpper) * FX_FEE_BPS, Q64), 10_000n);
  return fee > 1n ? fee : 1n;
}

/** Orca's `test_exact_bit_values`, shared with the tests: (tick, √P(tick), √P(−tick)). */
export const ORCA_EXACT_BIT_VALUES: [number, bigint, bigint][] = [
  [0, 18446744073709551616n, 18446744073709551616n],
  [1, 18447666387855959850n, 18445821805675392311n],
  [2, 18448588748116922571n, 18444899583751176498n],
  [4, 18450433606991734263n, 18443055278223354162n],
  [8, 18454123878217468680n, 18439367220385604838n],
  [16, 18461506635090006701n, 18431993317065449817n],
  [32, 18476281010653910144n, 18417254355718160513n],
  [64, 18505865242158250041n, 18387811781193591352n],
  [128, 18565175891880433522n, 18329067761203520168n],
  [256, 18684368066214940582n, 18212142134806087854n],
  [512, 18925053041275764671n, 17980523815641551639n],
  [1024, 19415764168677886926n, 17526086738831147013n],
  [2048, 20435687552633177494n, 16651378430235024244n],
  [4096, 22639080592224303007n, 15030750278693429944n],
  [8192, 27784196929998399742n, 12247334978882834399n],
  [16384, 41848122137994986128n, 8131365268884726200n],
  [32768, 94936283578220370716n, 3584323654723342297n],
  [65536, 488590176327622479860n, 696457651847595233n],
  [131072, 12941056668319229769860n, 26294789957452057n],
  [262144, 9078618265828848800676189n, 37481735321082n],
];
