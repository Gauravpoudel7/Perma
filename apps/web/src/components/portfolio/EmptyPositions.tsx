/** COPY-DECK §4.2 empty state, verbatim. */
export function EmptyPositions() {
  return (
    <div className="rounded-md border border-border bg-surface p-8 text-center">
      <p className="text-body-md text-text-muted">
        No open positions. Open a short to provide liquidity, or a long to buy against
        existing short inventory.
      </p>
    </div>
  );
}
