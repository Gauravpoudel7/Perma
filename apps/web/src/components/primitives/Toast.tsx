"use client";

import { explorerTxUrl } from "../../lib/explorer";
import { useToastStore } from "../../store/useToastStore";

export type ToastVariant = "pending" | "success" | "error";

export interface ToastData {
  id: string;
  variant: ToastVariant;
  message: string;
  signature?: string;
  /** Optional mono line under the message — e.g. the decoded on-chain event names. */
  detail?: string;
}

/**
 * Solid black surface, 1px left border colored by variant (white=pending,
 * success=green accent used sparingly, danger=red) — per
 * COMPONENT-LIBRARY.md §5. No glassmorphism, no drop shadow.
 */
export function Toast({ toast }: { toast: ToastData }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const borderColor =
    toast.variant === "error"
      ? "border-l-danger"
      : toast.variant === "success"
      ? "border-l-success"
      : "border-l-text-primary";

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={`transition-brand w-80 rounded-md border border-border ${borderColor} border-l-2 bg-surface p-4 text-body-sm text-text-primary shadow-none`}
    >
      <div className="flex items-start justify-between gap-3">
        <p>{toast.message}</p>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => dismiss(toast.id)}
          className="transition-brand focus-ring text-caption -mr-1 -mt-1 shrink-0 rounded-sm px-2 py-1 text-text-muted hover:text-text-primary"
        >
          Dismiss
        </button>
      </div>
      {toast.detail && <p className="mt-1 text-mono-sm text-text-muted">{toast.detail}</p>}
      {toast.signature && (
        <a
          href={explorerTxUrl(toast.signature)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-2 inline-block text-mono-sm text-text-muted underline underline-offset-2 hover:text-text-primary"
        >
          View transaction
        </a>
      )}
    </div>
  );
}
