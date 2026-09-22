import { EmptyState } from "../primitives/States";

/** COPY-DECK §4.1 empty-inventory copy, verbatim. */
export function InventoryEmptyState() {
  return (
    <EmptyState>
      No short liquidity in this range. A long needs existing short liquidity to open against.
    </EmptyState>
  );
}
