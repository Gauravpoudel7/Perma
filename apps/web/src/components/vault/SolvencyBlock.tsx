import { InlineError } from "../primitives/States";

/** COPY-DECK §4.3 solvency-block copy, verbatim. Shown when a live withdraw preflight fails. */
export function SolvencyBlock() {
  return (
    <InlineError>
      This withdrawal would leave less than your open longs owe in premium. Settle or close a long
      first.
    </InlineError>
  );
}

/** COPY-DECK §4.3 insufficient-balance copy, verbatim. */
export function InsufficientBlock() {
  return (
    <InlineError>You can only withdraw free collateral. Close a position to release locked funds.</InlineError>
  );
}
