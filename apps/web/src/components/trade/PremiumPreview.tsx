"use client";

import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { formatBaseUnits, parseToBaseUnits } from "../../lib/format";

const DECIMALS_B = 6;
const PREMIUM_SCALE = 1_000_000_000_000n;
// 400ms/slot -> 9000 slots/hour. This is the same constant the on-chain
// program's slot cadence assumes elsewhere in this codebase's docs; it is
// only used here to convert a per-slot rate into a per-hour ESTIMATE.
const SLOTS_PER_HOUR = 9000n;

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

  const perHourScaled =
    BigInt(market.premiumRate.toString()) *
    liquidity *
    BigInt(market.premiumMultiplier.toString()) *
    SLOTS_PER_HOUR;
  const perHour = perHourScaled / PREMIUM_SCALE;

  return (
    <p className="text-body-sm text-text-muted">
      Est. premium per hour, at the current rate:{" "}
      <span className="text-mono-sm tabular-nums text-text-primary">
        {formatBaseUnits(perHour, DECIMALS_B, 6)} USDC
      </span>
    </p>
  );
}
