"use client";

import { Table, TableHead, TableHeaderCell, TableBody, TableRow } from "../primitives/Table";
import { PositionRow } from "./PositionRow";
import { EmptyPositions } from "./EmptyPositions";
import { STATUS_CLOSED } from "../../lib/constants";
import type { PositionWithPubkey } from "../../lib/accounts";

/**
 * Columns: Side · Range · Size · Accrued Premium (Est.) · Status · Action.
 * No P&L column, no summary Solvency Ratio row — see the honesty overrides
 * in the plan. Closed positions never render here; there is no history view
 * in Fair MVP (component 11 territory).
 */
export function PositionsTable({ positions }: { positions: PositionWithPubkey[] }) {
  const live = positions.filter((p) => p.status !== STATUS_CLOSED);

  if (live.length === 0) return <EmptyPositions />;

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Side</TableHeaderCell>
          <TableHeaderCell>Range</TableHeaderCell>
          <TableHeaderCell>Size</TableHeaderCell>
          <TableHeaderCell>Accrued Premium</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Action</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {live.map((p) => (
          <PositionRow key={p.pubkey.toBase58()} position={p} />
        ))}
      </TableBody>
    </Table>
  );
}
