"use client";

import { DataTile } from "../primitives/DataTile";
import { useChainStore } from "../../store/useChainStore";
import { useOpenLongs } from "../../hooks/useOpenLongs";
import { projectedIndex, requiredFreeUsdc } from "../../lib/solvency";
import { formatBaseUnits } from "../../lib/format";

const DECIMALS_B = 6;

/**
 * The Fair-MVP replacement for a "Solvency Ratio %": a real amount, computed
 * exactly as `withdraw_collateral`'s on-chain gate computes it —
 * `premium_owed_usdc + Σ(accrued + margin)` over the owner's open longs,
 * with the premium index projected to a display-time estimate of "now".
 */
export function RequiredFreeUsdcTile() {
  const uc = useChainStore((s) => s.userCollateral);
  const market = useChainStore((s) => s.market);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const openLongs = useOpenLongs();

  if (!uc || !market) {
    return <DataTile label="Required free USDC" value="—" />;
  }

  const marketRiskFields = {
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
    BigInt(uc.premiumOwedUsdc.toString()),
    openLongs.map((p) => ({
      accruedScaled: BigInt(p.accruedScaled.toString()),
      entryIndex: BigInt(p.entryIndex.toString()),
      liquidity: BigInt(p.liquidity.toString()),
    })),
    projected,
    marketRiskFields
  );

  return (
    <DataTile
      label="Required free USDC"
      value={`${formatBaseUnits(required, DECIMALS_B, 6)} USDC`}
      hint={openLongs.length > 0 ? `${openLongs.length} open long${openLongs.length === 1 ? "" : "s"}` : undefined}
    />
  );
}
