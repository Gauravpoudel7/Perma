/** COPY-DECK §4.1 empty-inventory copy, verbatim. */
export function InventoryEmptyState() {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-body-sm text-text-muted">
        No short liquidity in this range. A long needs existing short liquidity to open
        against.
      </p>
    </div>
  );
}
