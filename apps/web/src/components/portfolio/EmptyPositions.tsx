import { EmptyState } from "../primitives/States";

/** COPY-DECK §4.2 empty state, verbatim. */
export function EmptyPositions() {
  return (
    <EmptyState className="p-8 text-center">
      No open positions. Open a short to provide liquidity, or a long to buy against existing
      short inventory.
    </EmptyState>
  );
}
