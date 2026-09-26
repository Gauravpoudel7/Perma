"use client";

import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useTicketSize } from "../../hooks/useTicketSize";
import { useRequiredFreeUsdc } from "../../hooks/useRequiredFreeUsdc";
import { formatBaseUnits } from "../../lib/format";
import { estPremiumPerHour, requiredMargin } from "../../lib/solvency";
import { MIN_RANGE_TICKS } from "../../lib/tickMath";

const DECIMALS_B = 6;

/**
 * COPY-DECK §4.1: "Est. premium per hour, at the current rate." Long side
 * only — a short earns, doesn't pay. It is the headline of a long ticket:
 * premium is the money a long actually pays, and the margin is what it must
 * keep free to open.
 */
export function PremiumPreview() {
  const market = useChainStore((s) => s.market);
  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const liquidity = useTicketSize()?.liquidity ?? null;
  const requiredView = useRequiredFreeUsdc();

  if (side !== "long" || !market || !liquidity || tickUpper - tickLower < MIN_RANGE_TICKS) return null;
  const range = { tickLower, tickUpper };

  const risk = {
    longMarginHorizonSlots: BigInt(market.longMarginHorizonSlots.toString()),
    premiumRate: BigInt(market.premiumRate.toString()),
    premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
    longMarginBufferUsdc: BigInt(market.longMarginBufferUsdc.toString()),
  };
  const perHour = estPremiumPerHour(risk, liquidity, range);

  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-body-sm text-text-muted">Est. premium per hour, at the current rate</p>
      <p className="text-h4 tabular-nums text-text-primary">{formatBaseUnits(perHour, DECIMALS_B, 6)} USDC</p>
      <p className="text-body-sm mt-1 text-text-muted">
        Required margin{" "}
        <span className="text-mono-sm tabular-nums text-text-primary">
          {formatBaseUnits(requiredMargin(risk, liquidity, range), DECIMALS_B, 2)} USDC
        </span>
        {requiredView && (
          <>
            {" "}
            of your{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">
              {formatBaseUnits(requiredView.freeUsdc, DECIMALS_B, 2)} USDC
            </span>{" "}
            free
          </>
        )}
        .
      </p>
    </div>
  );
}
