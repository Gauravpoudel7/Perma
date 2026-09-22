"use client";

import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { formatBaseUnits } from "../../lib/format";
import { estPremiumPerHour } from "../../lib/solvency";

const DECIMALS_B = 6;

/** COPY-DECK §4.1: "Est. premium per hour, at the current rate." Long side only — a short earns, doesn't pay. */
export function PremiumPreview() {
  const market = useChainStore((s) => s.market);
  const side = useTradeFormStore((s) => s.side);
  const sizeInput = useTradeFormStore((s) => s.sizeInput);

  if (side !== "long" || !market || !sizeInput) return null;

  let liquidity: bigint;
  try {
    liquidity = BigInt(sizeInput);
  } catch {
    return null;
  }

  const perHour = estPremiumPerHour(
    {
      premiumRate: BigInt(market.premiumRate.toString()),
      premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
    },
    liquidity
  );

  return (
    <p className="text-body-sm text-text-muted">
      Est. premium per hour, at the current rate:{" "}
      <span className="text-mono-sm tabular-nums text-text-primary">
        {formatBaseUnits(perHour, DECIMALS_B, 6)} USDC
      </span>
    </p>
  );
}
