/** COPY-DECK §4.3 solvency-block copy, verbatim. Shown when a live withdraw preflight fails. */
export function SolvencyBlock() {
  return (
    <p role="alert" className="text-body-sm text-danger">
      This withdrawal would leave less than your open longs owe in premium. Settle or close a
      long first.
    </p>
  );
}

/** COPY-DECK §4.3 insufficient-balance copy, verbatim. */
export function InsufficientBlock() {
  return (
    <p role="alert" className="text-body-sm text-danger">
      You can only withdraw free collateral. Close a position to release locked funds.
    </p>
  );
}
