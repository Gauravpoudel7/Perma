"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { ReviewSheet } from "./ReviewSheet";
import { useOpenPosition } from "../../hooks/useOpenPosition";
import type { TickArrayStatus } from "../../lib/tickArray";

/**
 * The ticket's primary CTA. Click opens the ReviewSheet; Confirm there runs
 * the unchanged mint path (`useOpenPosition.handleOpen`). The disabled reason
 * is visible text, not only a tooltip, so a blocked ticket says why.
 */
export function OpenPositionButton({
  tickArrayStatus,
}: {
  tickArrayStatus: TickArrayStatus | null;
}) {
  const { side, disabledReason, needsDeposit, busy, progress, summary, handleOpen } = useOpenPosition(tickArrayStatus);
  const [reviewOpen, setReviewOpen] = useState(false);
  // The liquidity the user reviewed. If spot moves the mixed-range amounts
  // while the sheet is open, Confirm first shows the new figures.
  const [reviewedLiquidity, setReviewedLiquidity] = useState<bigint | null>(null);
  const changed = reviewOpen && summary !== null && reviewedLiquidity !== null && summary.liquidity !== reviewedLiquidity;
  const ctaRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setReviewOpen(false);
    ctaRef.current?.focus();
  }, []);

  const confirm = useCallback(() => {
    if (changed && summary) {
      setReviewedLiquidity(summary.liquidity);
      return;
    }
    setReviewOpen(false);
    ctaRef.current?.focus();
    void handleOpen();
  }, [changed, summary, handleOpen]);

  const label = side === "short" ? "Open Short" : "Open Long";

  return (
    <div className="flex flex-col gap-2">
      {disabledReason && (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          {disabledReason}
          {needsDeposit && (
            <>
              {" "}
              <Link href="/vault" className="focus-ring rounded-sm text-text-primary underline underline-offset-2">
                Deposit on Vault
              </Link>
            </>
          )}
        </p>
      )}
      <Button
        ref={ctaRef}
        className="w-full"
        disabled={disabledReason !== null || busy || !summary}
        onClick={() => {
          setReviewedLiquidity(summary?.liquidity ?? null);
          setReviewOpen(true);
        }}
      >
        {busy ? "Opening…" : label}
      </Button>
      {busy && progress && (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          {progress}
        </p>
      )}
      <ReviewSheet open={reviewOpen} summary={summary} changed={changed} onCancel={close} onConfirm={confirm} />
    </div>
  );
}
