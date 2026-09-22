import type { ReactNode } from "react";

/**
 * Shared loading / empty / degraded / error surfaces. Every screen that has
 * nothing (yet) to show goes through one of these four, so "no data" always
 * looks the same and is never mistaken for a value.
 *
 * Skeleton is a static block, not a shimmer: BRAND-SYSTEM allows only 100ms
 * linear transitions, and a looping pulse is neither. Static also means
 * `prefers-reduced-motion` needs no special case.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div role="status" aria-busy="true" aria-label="Loading" className={`rounded-sm bg-surface ${className}`} />;
}

/** No data, and that is a fact about the chain, not a failure. */
export function EmptyState({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-surface p-4 ${className}`}>
      <p className="text-body-sm text-text-muted">{children}</p>
    </div>
  );
}

/** A secondary source (indexer) is missing or stale. Live RPC state is unaffected. */
export function DegradedState({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-border bg-surface p-4">
      <p className="text-body-sm text-text-muted">{children}</p>
    </div>
  );
}

/** Something the user can act on. `action` is the recovery CTA (a Button or Link). */
export function InlineError({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-body-sm text-danger">{children}</p>
      {action}
    </div>
  );
}
