"use client";

import { useCallback, useRef, useState } from "react";
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
  const { side, disabledReason, busy, summary, handleOpen } = useOpenPosition(tickArrayStatus);
  const [reviewOpen, setReviewOpen] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setReviewOpen(false);
    ctaRef.current?.focus();
  }, []);

  const confirm = useCallback(() => {
    setReviewOpen(false);
    ctaRef.current?.focus();
    void handleOpen();
  }, [handleOpen]);

  const label = side === "short" ? "Open Short" : "Open Long";

  return (
    <div className="flex flex-col gap-2">
      {disabledReason && (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          {disabledReason}
        </p>
      )}
      <Button
        ref={ctaRef}
        className="w-full"
        disabled={disabledReason !== null || busy || !summary}
        onClick={() => setReviewOpen(true)}
      >
        {busy ? "Confirm in your wallet" : label}
      </Button>
      <ReviewSheet open={reviewOpen} summary={summary} onCancel={close} onConfirm={confirm} />
    </div>
  );
}
