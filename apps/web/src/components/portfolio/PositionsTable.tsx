"use client";

import { createRef, useMemo, useState, type RefObject } from "react";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow } from "../primitives/Table";
import { PositionRow } from "./PositionRow";
import { PositionDetail } from "./PositionDetail";
import { EmptyPositions } from "./EmptyPositions";
import { STATUS_CLOSED } from "../../lib/constants";
import type { PositionWithPubkey } from "../../lib/accounts";

/**
 * Columns: Side · Range · Size · Accrued Premium (Est.) · Status · Action.
 * No P&L column and no solvency row — ADR-0003: a long closes at 0 and a
 * short's realized LP result is applied once, at close. Closed positions
 * never render here; History (indexer) is where they go.
 *
 * Below `md` the header hides and each row lays out as a card; it is the
 * same table element, so table and cards read one set of facts.
 */
export function PositionsTable({ positions }: { positions: PositionWithPubkey[] }) {
  const live = positions.filter((p) => p.status !== STATUS_CLOSED);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // One ref per row so the sheet can hand focus back to the "Details" that opened it.
  const detailRefs = useMemo(() => {
    const m = new Map<string, RefObject<HTMLButtonElement>>();
    for (const p of live) m.set(p.pubkey.toBase58(), createRef<HTMLButtonElement>());
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.map((p) => p.pubkey.toBase58()).join(",")]);

  // Re-derive from the live list on every render, so a position that closes
  // while its sheet is open simply closes the sheet.
  const selected = selectedKey ? live.find((p) => p.pubkey.toBase58() === selectedKey) ?? null : null;

  if (live.length === 0) return <EmptyPositions />;

  function close() {
    const key = selectedKey;
    setSelectedKey(null);
    if (key) detailRefs.get(key)?.current?.focus();
  }

  return (
    <>
      <Table>
        <TableHead className="hidden md:table-header-group">
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
          {live.map((p) => {
            const key = p.pubkey.toBase58();
            return (
              <PositionRow key={key} ref={detailRefs.get(key)} position={p} onSelect={() => setSelectedKey(key)} />
            );
          })}
        </TableBody>
      </Table>
      <PositionDetail position={selected} onClose={close} />
    </>
  );
}
