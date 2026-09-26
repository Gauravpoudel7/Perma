"use client";

import { useChainStore } from "../store/useChainStore";
import { useRangeState } from "./useRangeState";
import { payableIfSettledNow, projectedIndex, shortAccruedPremium, shortPayableNow } from "../lib/solvency";
import { positionActions, type PositionActions } from "../lib/positionActions";
import { tickToPrice } from "../lib/whirlpool";
import { positionAmounts } from "../lib/liquidityMath";
import { formatPair } from "../lib/format";
import { LEG_LONG, STATUS_PENDING_PREMIUM } from "../lib/constants";
import type { PositionWithPubkey } from "../lib/accounts";

// Demo pool: WSOL (9 decimals) / devUSDC (6 decimals).
const DECIMALS_A = 9;
const DECIMALS_B = 6;

export interface PositionSummary {
  isLong: boolean;
  sideLabel: string;
  lowPrice: number;
  highPrice: number;
  liquidity: bigint;
  /** Display-only "Accrued Premium (Est.)" in µUSDC; see the math note below. */
  accrued: bigint;
  /**
   * µUSDC `settle_premium` would pay a short now. Null until the range
   * account has loaded. Zero when the escrow is empty.
   */
  shortPayable: bigint | null;
  /** Close / Settle flags. The only producer; rows and the detail sheet both read this. */
  actions: PositionActions;
  pending: boolean;
  statusLabel: "Open" | "Pending Premium";
  /**
   * The size in tokens at spot, e.g. "0.4 SOL + 52.1 USDC" - the same
   * conversion the Trade ticket uses. Null before spot loads, and for a
   * Pending Premium short, whose Orca liquidity is already withdrawn.
   */
  sizeLabel: string | null;
}

/**
 * The one view-model for a position, read by the table row and the detail
 * sheet so the two can never show different numbers. The accrued figure is
 * the pre-U3 `PositionRow` math, moved: a long's payable-if-settled-now
 * against the projected index (using `lastUpdateSlot` as a conservative
 * "now"), a short's uncapped entitlement from its range's accumulator. It is
 * an estimate labeled "Est." everywhere it appears (COPY-DECK §3).
 * Returns null until the Market account has loaded.
 */
export function usePositionSummary(position: PositionWithPubkey): PositionSummary | null {
  const market = useChainStore((s) => s.market);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const rangeState = useRangeState(position.tickLower, position.tickUpper);
  const spot = useChainStore((s) => s.spot);

  if (!market) return null;

  const isLong = position.legType === LEG_LONG;

  const pending = position.status === STATUS_PENDING_PREMIUM;
  const receivable = BigInt(position.premiumReceivable.toString());

  let accrued = 0n;
  let shortPayable: bigint | null = null;
  if (isLong && premiumIndex) {
    const projected = projectedIndex(
      { currentIndex: BigInt(premiumIndex.currentIndex.toString()), lastUpdateSlot: BigInt(premiumIndex.lastUpdateSlot.toString()) },
      BigInt(market.premiumRate.toString()),
      // Using lastUpdateSlot as a lower-bound "now" is deliberately conservative
      // display-only; the on-chain gate always uses the real current slot.
      BigInt(premiumIndex.lastUpdateSlot.toString())
    );
    accrued = payableIfSettledNow(
      {
        accruedScaled: BigInt(position.accruedScaled.toString()),
        entryIndex: BigInt(position.entryIndex.toString()),
        liquidity: BigInt(position.liquidity.toString()),
      },
      projected,
      BigInt(market.premiumMultiplier.toString())
    );
  } else if (!isLong && rangeState) {
    const shortPos = {
      entryAccQ64: BigInt(position.entryAccQ64.toString()),
      liquidity: BigInt(position.liquidity.toString()),
      premiumReceivable: receivable,
    };
    const range = { accPremiumPerShortQ64: BigInt(rangeState.accPremiumPerShortQ64.toString()) };
    accrued = shortAccruedPremium(shortPos, range);
    shortPayable = shortPayableNow(shortPos, {
      ...range,
      premiumPool: BigInt(rangeState.premiumPool.toString()),
    });
  } else if (!isLong && pending) {
    // Liquidity is already 0, so nothing new is claimable. The carried claim
    // is on the position and can be shown before the range account loads.
    accrued = receivable;
  }

  const actions = positionActions({
    legType: position.legType,
    status: position.status,
    accrued,
    shortPayable,
  });

  const liquidity = BigInt(position.liquidity.toString());
  const amounts =
    spot && !pending ? positionAmounts(liquidity, spot.tickCurrentIndex, position.tickLower, position.tickUpper) : null;

  return {
    isLong,
    sideLabel: isLong ? "Long (buy against inventory)" : "Short (provide liquidity)",
    lowPrice: tickToPrice(position.tickLower, DECIMALS_A, DECIMALS_B),
    highPrice: tickToPrice(position.tickUpper, DECIMALS_A, DECIMALS_B),
    liquidity,
    accrued,
    shortPayable,
    actions,
    pending,
    statusLabel: pending ? "Pending Premium" : "Open",
    sizeLabel: amounts ? formatPair(amounts.amountA, amounts.amountB) : null,
  };
}
