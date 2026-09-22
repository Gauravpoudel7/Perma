"use client";

import { forwardRef, type ReactNode } from "react";
import { TableRow, TableCell } from "../primitives/Table";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";
import { CloseSettleAction } from "./CloseSettleAction";
import { usePositionSummary } from "../../hooks/usePositionSummary";
import { formatBaseUnits } from "../../lib/format";
import type { PositionWithPubkey } from "../../lib/accounts";

const DECIMALS_B = 6;

/**
 * One position, as a table row on `md+` and as a card below — the same
 * DOM, restyled. Each cell carries its own caption label that only shows
 * in card mode, so the card can never list a fact the table does not.
 * All figures come from `usePositionSummary`; nothing is computed here.
 */
export const PositionRow = forwardRef<
  HTMLButtonElement,
  { position: PositionWithPubkey; onSelect: () => void }
>(function PositionRow({ position, onSelect }, detailsRef) {
  const s = usePositionSummary(position);
  if (!s) return null;

  return (
    <TableRow className="block cursor-pointer p-4 md:table-row md:p-0" onClick={onSelect}>
      <Cell label="Side">{s.isLong ? "Long" : "Short"}</Cell>
      <Cell label="Range" mono>
        {s.lowPrice.toFixed(2)}–{s.highPrice.toFixed(2)} USDC/SOL
      </Cell>
      <Cell label="Size" mono>
        {s.liquidity.toString()}
      </Cell>
      <Cell label="Accrued Premium" mono>
        Est. {formatBaseUnits(s.accrued, DECIMALS_B, 6)} USDC
      </Cell>
      <Cell label="Status">
        <Badge tone={s.pending ? "warning" : "neutral"}>{s.statusLabel}</Badge>
      </Cell>
      <Cell label="Action">
        <div className="flex items-center justify-end gap-2 md:justify-start" onClick={(e) => e.stopPropagation()}>
          <Button ref={detailsRef} variant="secondary" onClick={onSelect}>
            Details
          </Button>
          <CloseSettleAction position={position} hasAccrued={s.accrued > 0n} />
        </div>
      </Cell>
    </TableRow>
  );
});

function Cell({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <TableCell
      className={`flex items-center justify-between gap-4 !px-0 !py-1 md:table-cell md:!px-4 md:!py-3 ${
        mono ? "text-mono-md tabular-nums" : ""
      }`}
    >
      <span className="text-caption font-sans text-text-muted md:hidden">{label}</span>
      <span>{children}</span>
    </TableCell>
  );
}
