"use client";

import { useChainStore } from "../store/useChainStore";
import { useRangeState } from "./useRangeState";
import { payableIfSettledNow, projectedIndex, shortAccruedPremium } from "../lib/solvency";
import { tickToPrice } from "../lib/whirlpool";
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
  pending: boolean;
  statusLabel: "Open" | "Pending Premium";
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

  if (!market) return null;

  const isLong = position.legType === LEG_LONG;

  let accrued = 0n;
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
    accrued = shortAccruedPremium(
      {
        entryAccQ64: BigInt(position.entryAccQ64.toString()),
        liquidity: BigInt(position.liquidity.toString()),
        premiumReceivable: BigInt(position.premiumReceivable.toString()),
      },
      { accPremiumPerShortQ64: BigInt(rangeState.accPremiumPerShortQ64.toString()) }
    );
  }

  const pending = position.status === STATUS_PENDING_PREMIUM;

  return {
    isLong,
    sideLabel: isLong ? "Long (buy against inventory)" : "Short (provide liquidity)",
    lowPrice: tickToPrice(position.tickLower, DECIMALS_A, DECIMALS_B),
    highPrice: tickToPrice(position.tickUpper, DECIMALS_A, DECIMALS_B),
    liquidity: BigInt(position.liquidity.toString()),
    accrued,
    pending,
    statusLabel: pending ? "Pending Premium" : "Open",
  };
}
