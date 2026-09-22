/**
 * The ADR-0003 / component-09 solvency formula, and nowhere else.
 *
 * Fair MVP reads no price for solvency — there is no oracle, no TWAP, and no
 * P&L. A long's obligation is purely a function of time and liquidity: what
 * it has accrued, plus a margin for what it will accrue over the next
 * `long_margin_horizon_slots`. This module is the ONLY place that formula is
 * implemented; the Trade preflight and the Vault "Required free USDC" tile
 * both import it rather than reimplementing it per-screen.
 *
 * All math is bigint and rounds UP (ceiling), matching
 * `programs/perma/src/risk.rs` exactly — never floating point, never a
 * shortcut. At the deployed defaults (`horizon=1000, rate=1_000_000,
 * multiplier=1_000`) this collapses to `requiredMargin(L) == L + 1_000_000`
 * (L µUSDC + 1 USDC) — call that out in a comment where it's surprising,
 * never hardcode it: a future deploy could change the defaults, and this
 * module always reads the live `Market` fields.
 */

export const PREMIUM_SCALE = 1_000_000_000_000n;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export interface MarketRiskFields {
  longMarginHorizonSlots: bigint;
  premiumRate: bigint;
  premiumMultiplier: bigint;
  longMarginBufferUsdc: bigint;
}

/** `ceil(horizon × rate × L × mult / PREMIUM_SCALE) + buffer`, in µUSDC. */
export function requiredMargin(market: MarketRiskFields, liquidity: bigint): bigint {
  const raw =
    market.longMarginHorizonSlots *
    market.premiumRate *
    liquidity *
    market.premiumMultiplier;
  return ceilDiv(raw, PREMIUM_SCALE) + market.longMarginBufferUsdc;
}

// 400ms/slot -> 9000 slots/hour. Display-only conversion of the per-slot
// rate into a per-hour ESTIMATE; the chain accrues per slot, never per hour.
const SLOTS_PER_HOUR = 9000n;

/**
 * COPY-DECK §4.1 "Est. premium per hour, at the current rate", in µUSDC:
 * `rate × L × mult × 9000 / PREMIUM_SCALE`, rounded down (an estimate, not a
 * gate — the gate is `requiredMargin`). Shared by the ticket preview and the
 * review sheet so the two never disagree.
 */
export function estPremiumPerHour(
  market: Pick<MarketRiskFields, "premiumRate" | "premiumMultiplier">,
  liquidity: bigint
): bigint {
  return (market.premiumRate * liquidity * market.premiumMultiplier * SLOTS_PER_HOUR) / PREMIUM_SCALE;
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

export interface LongLiabilityFields {
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
  const scaled = pos.accruedScaled + dIndex * pos.liquidity * premiumMultiplier;
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
      requiredMargin(market, pos.liquidity),
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
  market: MarketRiskFields
): boolean {
  return freeB >= existingRequired + requiredMargin(market, newLiquidity);
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
