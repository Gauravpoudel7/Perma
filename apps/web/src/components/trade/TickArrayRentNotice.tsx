"use client";

import { formatBaseUnits } from "../../lib/format";

/** COPY-DECK §4.1 rent-notice copy, verbatim, with a real computed lamport amount. */
export function TickArrayRentNotice({ lamports }: { lamports: bigint }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-body-sm text-text-muted">
        This range needs a new tick array. One-time cost:{" "}
        <span className="text-mono-sm tabular-nums text-text-primary">
          {formatBaseUnits(lamports, 9, 9)} SOL
        </span>
        , paid by you and not refundable while the range is in use.
      </p>
    </div>
  );
}
