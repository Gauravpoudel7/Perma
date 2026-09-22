"use client";

import { useRef } from "react";
import { Button } from "../primitives/Button";
import { SlideOver, SlideOverRow } from "../primitives/SlideOver";

export interface ReviewRow {
  label: string;
  value: string;
  hint?: string;
}

/**
 * Review-before-sign for Deposit and Withdraw: the amounts the transaction
 * will carry and the free-USDC figures the chain will check. Nothing else —
 * no rate, no return figure, no projection.
 */
export function VaultReviewSheet({
  open,
  title,
  rows,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  rows: ReviewRow[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <SlideOver
      open={open}
      title={title}
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
        {rows.map((r) => (
          <SlideOverRow key={r.label} label={r.label} value={r.value} hint={r.hint} />
        ))}
      </dl>
    </SlideOver>
  );
}
