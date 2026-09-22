"use client";

import { useRef } from "react";
import { Button } from "../primitives/Button";
import { SlideOver, SlideOverRow as Row } from "../primitives/SlideOver";
import { formatBaseUnits } from "../../lib/format";
import type { OpenPositionSummary } from "../../hooks/useOpenPosition";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * Review-before-mint. Every row is a value the transaction will actually
 * carry or the chain will actually check — there is no payoff curve, no
 * Greek, no P&L, because Fair has none of those to show. Confirm hands off
 * to the same `handleOpen` the button used before U1.
 */
export function ReviewSheet({
  open,
  summary,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  summary: OpenPositionSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!summary) return null;

  const isLong = summary.side === "long";
  const confirmLabel = isLong ? "Confirm Open Long" : "Confirm Open Short";

  return (
    <SlideOver
      open={open}
      title="Review position"
      subtitle="Check every value. Confirming opens your wallet to sign."
      onClose={onCancel}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <dl className="flex flex-col gap-4">
        <Row label="Market" value="SOL/USDC · Orca Whirlpool" mono={false} />
        <Row label="Side" value={isLong ? "Long (buy against inventory)" : "Short (provide liquidity)"} mono={false} />
        <Row
          label="Realized range"
          value={`${summary.lowPrice.toFixed(2)}–${summary.highPrice.toFixed(2)} USDC/SOL`}
          hint={`ticks ${summary.tickLower} to ${summary.tickUpper}`}
        />
        <Row label="Position size" value={`${summary.liquidity.toString()} liquidity units`} />
        {isLong && summary.premiumPerHourUsdc !== null && (
          <Row
            label="Est. premium per hour, at the current rate"
            value={`${formatBaseUnits(summary.premiumPerHourUsdc, DECIMALS_B, 6)} USDC`}
          />
        )}
        {isLong && summary.requiredMarginUsdc !== null && (
          <Row
            label="Required margin"
            value={`${formatBaseUnits(summary.requiredMarginUsdc, DECIMALS_B, 6)} USDC`}
            hint={
              summary.freeUsdc !== null ? `Free USDC now: ${formatBaseUnits(summary.freeUsdc, DECIMALS_B, 2)}` : undefined
            }
          />
        )}
        {!isLong && summary.tokenMaxA !== null && summary.tokenMaxB !== null && (
          <Row
            label="Max collateral locked (slippage cap)"
            value={`${formatBaseUnits(summary.tokenMaxA, DECIMALS_A, 4)} SOL / ${formatBaseUnits(
              summary.tokenMaxB,
              DECIMALS_B,
              2
            )} USDC`}
            hint="Orca locks what the range needs at execution, up to these caps."
          />
        )}
      </dl>
      {summary.needsRent && (
        <p className="text-body-sm border-t border-border pt-4 text-text-muted">
          This range needs a new tick array. The one-time rent shown on the ticket is paid by you and not
          refundable while the range is in use.
        </p>
      )}
    </SlideOver>
  );
}
