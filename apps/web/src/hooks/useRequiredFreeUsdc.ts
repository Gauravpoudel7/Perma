"use client";

import { useChainStore } from "../store/useChainStore";
import { useOpenLongs } from "./useOpenLongs";
import { projectedIndex, requiredFreeUsdc, type MarketRiskFields } from "../lib/solvency";

export interface RequiredFreeUsdcView {
  /** `premium_owed_usdc + Σ(accrued + margin)` over the owner's open longs, µUSDC — the withdraw gate's number. */
  required: bigint;
  /** The wallet's free (unlocked) USDC, µUSDC. */
  freeUsdc: bigint;
  openLongsCount: number;
  marketRiskFields: MarketRiskFields;
}

/**
 * The one place the Vault tile, the withdraw preflight and the long-mint
 * preflight read "how much free USDC must stay". It mirrors
 * `withdraw_collateral`'s on-chain gate via `lib/solvency.ts`, with the
 * premium index projected to a display-time "now" (`lastUpdateSlot` as a
 * conservative lower bound). Null until Market and UserCollateral have
 * loaded. Display-only: every transaction re-reads open longs fresh.
 */
export function useRequiredFreeUsdc(): RequiredFreeUsdcView | null {
  const market = useChainStore((s) => s.market);
  const userCollateral = useChainStore((s) => s.userCollateral);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const openLongs = useOpenLongs();

  if (!market || !userCollateral) return null;

  const marketRiskFields: MarketRiskFields = {
    longMarginHorizonSlots: BigInt(market.longMarginHorizonSlots.toString()),
    premiumRate: BigInt(market.premiumRate.toString()),
    premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
    longMarginBufferUsdc: BigInt(market.longMarginBufferUsdc.toString()),
  };

  const projected = premiumIndex
    ? projectedIndex(
        {
          currentIndex: BigInt(premiumIndex.currentIndex.toString()),
          lastUpdateSlot: BigInt(premiumIndex.lastUpdateSlot.toString()),
        },
        marketRiskFields.premiumRate,
        BigInt(premiumIndex.lastUpdateSlot.toString())
      )
    : 0n;

  const required = requiredFreeUsdc(
    BigInt(userCollateral.premiumOwedUsdc.toString()),
    openLongs.map((p) => ({
      accruedScaled: BigInt(p.accruedScaled.toString()),
      entryIndex: BigInt(p.entryIndex.toString()),
      liquidity: BigInt(p.liquidity.toString()),
    })),
    projected,
    marketRiskFields
  );

  return {
    required,
    freeUsdc: BigInt(userCollateral.balanceB.toString()),
    openLongsCount: openLongs.length,
    marketRiskFields,
  };
}
