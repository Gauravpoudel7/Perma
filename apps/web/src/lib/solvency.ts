import { notionalQ64, scaledCharge } from "./tickMath";

/**
 * The ADR-0003 / component-09 solvency formula, and nowhere else.
 *
 * Fair MVP reads no price for solvency — there is no oracle, no TWAP, and no
 * P&L. A long's obligation is purely a function of time and liquidity: what
 * it has accrued, plus a margin for what it will accrue over the next
 * `long_margin_horizon_slots`, priced on its notional `L × v` (ADR-0006: `v`
 * = √P(upper) − √P(lower), from `tickMath.ts`). This module is the ONLY place that formula is
 * implemented; the Trade preflight and the Vault "Required free USDC" tile
 * both import it rather than reimplementing it per-screen.
 *
 * All math is bigint and rounds UP (ceiling), matching
 * `programs/perma/src/risk.rs` exactly — never floating point, never a
 * shortcut. At the deployed defaults (`horizon=216_000, rate=11_111,
 * multiplier=1`) margin is ≈ 2.4 % of notional + 1 USDC; this module always
 * reads the live `Market` fields rather than assuming them.
 */

export const PREMIUM_SCALE = 1_000_000_000_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** The two ticks a long's notional is priced on. */
export interface TickRange {
  tickLower: number;
  tickUpper: number;
}

export interface MarketRiskFields {
  longMarginHorizonSlots: bigint;
  premiumRate: bigint;
  premiumMultiplier: bigint;
  longMarginBufferUsdc: bigint;
}

const Q64 = 1n << 64n;

/** `⌈horizon × rate × mult × (L × v) / (2^64 × PREMIUM_SCALE)⌉ + buffer`, in µUSDC (`risk::required_margin`). */
export function requiredMargin(market: MarketRiskFields, liquidity: bigint, range: TickRange): bigint {
  const raw =
    market.longMarginHorizonSlots *
    market.premiumRate *
    market.premiumMultiplier *
    notionalQ64(liquidity, range.tickLower, range.tickUpper);
  return ceilDiv(raw, Q64 * PREMIUM_SCALE) + market.longMarginBufferUsdc;
}

// 400ms/slot -> 9000 slots/hour. Display-only conversion of the per-slot
// rate into a per-hour ESTIMATE; the chain accrues per slot, never per hour.
const SLOTS_PER_HOUR = 9000n;

/**
 * COPY-DECK §4.1 "Est. premium per hour, at the current rate", in µUSDC:
 * 9000 slots of `premium::scaled_charge` on the long's notional, rounded down
 * (an estimate, not a gate — the gate is `requiredMargin`). Shared by the
 * ticket preview and the review sheet so the two never disagree.
 */
export function estPremiumPerHour(
  market: Pick<MarketRiskFields, "premiumRate" | "premiumMultiplier">,
  liquidity: bigint,
  range: TickRange
): bigint {
  const scaled = scaledCharge(
    market.premiumRate * SLOTS_PER_HOUR,
    market.premiumMultiplier,
    liquidity,
    range.tickLower,
    range.tickUpper,
    false
  );
  return scaled / PREMIUM_SCALE;
}

/**
 * Below this estimated amount, offering "Settle" is noise rather than a
 * choice: `settle_premium` leaves the long open, so it starts accruing again
 * at once and a button reappears for a rounding tail — which reads as though
 * the settle failed. 0.001 USDC is 1000x the smallest representable amount and
 * far below any real hourly rent (at the deployed rate a 1e6 position owes
 * ~9 USDC/hour), so this can only ever hide a tail, never rent. Display-only:
 * `Close` still settles whatever is owed, and the program keeps its own
 * `NothingToSettle` guard.
 */
export const SETTLE_DUST_USDC_MICRO = 1_000n;

/** The one place the UI decides whether "Settle" is worth showing. */
export function isSettleable(accruedUsdcMicro: bigint): boolean {
  return accruedUsdcMicro >= SETTLE_DUST_USDC_MICRO;
}

export interface PremiumIndexFields {
  currentIndex: bigint;
  lastUpdateSlot: bigint;
}

/**
 * Where the on-chain index would be at `currentSlot`, without writing it —
 * mirrors `premium::projected_index`. Needed because `withdraw_collateral`
 * does not run the poke prefix, so the stored index can lag; a stale read
 * would under-count a long's real liability.
 */
export function projectedIndex(
  index: PremiumIndexFields,
  premiumRate: bigint,
  currentSlot: bigint
): bigint {
  const elapsed = currentSlot > index.lastUpdateSlot ? currentSlot - index.lastUpdateSlot : 0n;
  return index.currentIndex + elapsed * premiumRate;
}

export interface LongLiabilityFields extends TickRange {
  accruedScaled: bigint;
  entryIndex: bigint;
  liquidity: bigint;
}

/**
 * What `settle_premium` would charge this long right now, rounded UP.
 * Mirrors `premium::payable_if_settled_now` — a read-only projection, never
 * a mutation.
 */
export function payableIfSettledNow(
  pos: LongLiabilityFields,
  projected: bigint,
  premiumMultiplier: bigint
): bigint {
  const dIndex = projected > pos.entryIndex ? projected - pos.entryIndex : 0n;
  const scaled =
    pos.accruedScaled + scaledCharge(dIndex, premiumMultiplier, pos.liquidity, pos.tickLower, pos.tickUpper, true);
  return ceilDiv(scaled, PREMIUM_SCALE);
}

/**
 * `premium_owed_usdc` (the legacy, only-ever-decreasing liability) plus, for
 * every open long, its current accrual and margin. This is the single number
 * the Vault's "Required free USDC" tile shows — a real amount, never a ratio.
 */
export function requiredFreeUsdc(
  premiumOwedUsdc: bigint,
  openLongs: LongLiabilityFields[],
  projected: bigint,
  market: MarketRiskFields
): bigint {
  return openLongs.reduce(
    (sum, pos) =>
      sum +
      payableIfSettledNow(pos, projected, market.premiumMultiplier) +
      requiredMargin(market, pos.liquidity, pos),
    premiumOwedUsdc
  );
}

/** `withdraw_collateral`'s gate, mirrored client-side for a live preflight. */
export function canWithdraw(freeB: bigint, amountB: bigint, required: bigint): boolean {
  return freeB - amountB >= required;
}

/** `mint_position(LONG)`'s gate, mirrored client-side for a live preflight. */
export function canMintLong(
  freeB: bigint,
  existingRequired: bigint,
  newLiquidity: bigint,
  market: MarketRiskFields,
  range: TickRange
): boolean {
  return freeB >= existingRequired + requiredMargin(market, newLiquidity, range);
}


/**
 * The largest long `L` that `canMintLong` still allows on `range`: the margin
 * term `⌈q × L × v / (2^64 × 1e12)⌉` must fit in `freeB − existingRequired −
 * buffer`. For integers, `⌈x / D⌉ ≤ R ⇔ x ≤ R × D`, so this is an exact
 * inverse and the ticket's "Max" never offers a size the program refuses.
 */
export function maxAffordableLiquidity(
  market: MarketRiskFields,
  freeB: bigint,
  existingRequired: bigint,
  range: TickRange
): bigint {
  const room = freeB - existingRequired - market.longMarginBufferUsdc;
  const perNotional = market.longMarginHorizonSlots * market.premiumRate * market.premiumMultiplier;
  const v = notionalQ64(1n, range.tickLower, range.tickUpper);
  if (room < 0n || perNotional === 0n || v === 0n) return 0n;
  return (room * Q64 * PREMIUM_SCALE) / (perNotional * v);
}

// --- Short-side entitlement (display only — mirrors premium::claimable_for /
// premium::claim_short_amount in programs/perma/src/premium.rs) ------------

export interface ShortRangeFields {
  accPremiumPerShortQ64: bigint;
}

export interface ShortPositionFields {
  entryAccQ64: bigint;
  liquidity: bigint;
  premiumReceivable: bigint;
}

/**
 * A short's total entitlement right now: what it has earned on elapsed time
 * (`claimable`) plus whatever was already earned but not yet funded by a
 * long (`premiumReceivable`, carried across a `PendingPremium` gap). This is
 * NOT capped by the range's `premium_pool` — that cap only limits what a
 * `settle_premium` call can actually pay out today, not what the position
 * has genuinely accrued. Portfolio's "Accrued Premium (Est.)" column shows
 * this uncapped figure, labeled "Est." per COPY-DECK §3.
 */
export function shortAccruedPremium(
  pos: ShortPositionFields,
  range: ShortRangeFields
): bigint {
  const claimable = ((range.accPremiumPerShortQ64 - pos.entryAccQ64) * pos.liquidity) >> 64n;
  return (claimable < 0n ? 0n : claimable) + pos.premiumReceivable;
}

/**
 * What `settle_premium` would pay this short right now, in µUSDC.
 *
 * Mirrors `premium::claim_short_amount`: owed is the uncapped entitlement
 * (`shortAccruedPremium`), and `paid = min(owed, premium_pool)`. A result of
 * 0 is `NothingToSettle` — the escrow has no USDC for this claim yet. The
 * U9 dust floor does not apply here; the program's own gate is `paid > 0`.
 */
export function shortPayableNow(
  pos: ShortPositionFields,
  range: ShortRangeFields & { premiumPool: bigint }
): bigint {
  const owed = shortAccruedPremium(pos, range);
  return owed < range.premiumPool ? owed : range.premiumPool;
}
