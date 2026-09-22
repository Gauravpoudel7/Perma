"use client";

import { DataTile } from "../primitives/DataTile";
import { useRequiredFreeUsdc } from "../../hooks/useRequiredFreeUsdc";
import { formatBaseUnits } from "../../lib/format";

const DECIMALS_B = 6;

/**
 * The Fair-MVP replacement for a "Solvency Ratio %": a real amount, computed
 * exactly as `withdraw_collateral`'s on-chain gate computes it (see
 * `useRequiredFreeUsdc`). Never a percentage — Fair reads no price.
 */
export function RequiredFreeUsdcTile() {
  const view = useRequiredFreeUsdc();

  if (!view) return <DataTile label="Required free USDC" value="—" />;

  return (
    <DataTile
      label="Required free USDC"
      value={`${formatBaseUnits(view.required, DECIMALS_B, 6)} USDC`}
      hint={
        view.openLongsCount > 0
          ? `${view.openLongsCount} open long${view.openLongsCount === 1 ? "" : "s"}`
          : "No open longs"
      }
      hintClassName="tabular-nums"
    />
  );
}
