"use client";

import { DataTile } from "../primitives/DataTile";
import { RequiredFreeUsdcTile } from "./RequiredFreeUsdcTile";
import { useChainStore } from "../../store/useChainStore";
import { formatBaseUnits } from "../../lib/format";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * Four tiles: Deposited / Locked / Available / Required free USDC — a real
 * computed number, never a "Solvency Ratio %" (no price input exists to
 * form a ratio from; see ADR-0003).
 */
export function CollateralSummary() {
  const uc = useChainStore((s) => s.userCollateral);

  if (!uc) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <DataTile label="Deposited" value="—" />
        <DataTile label="Locked by open positions" value="—" />
        <DataTile label="Available to withdraw" value="—" />
        <RequiredFreeUsdcTile />
      </div>
    );
  }

  const balanceA = BigInt(uc.balanceA.toString());
  const balanceB = BigInt(uc.balanceB.toString());
  const lockedA = BigInt(uc.lockedA.toString());
  const lockedB = BigInt(uc.lockedB.toString());

  const deposited = `${formatBaseUnits(balanceA + lockedA, DECIMALS_A, 4)} SOL / ${formatBaseUnits(
    balanceB + lockedB,
    DECIMALS_B,
    2
  )} USDC`;
  const locked = `${formatBaseUnits(lockedA, DECIMALS_A, 4)} SOL / ${formatBaseUnits(
    lockedB,
    DECIMALS_B,
    2
  )} USDC`;
  const available = `${formatBaseUnits(balanceA, DECIMALS_A, 4)} SOL / ${formatBaseUnits(
    balanceB,
    DECIMALS_B,
    2
  )} USDC`;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <DataTile label="Deposited" value={deposited} />
      <DataTile label="Locked by open positions" value={locked} />
      <DataTile label="Available to withdraw" value={available} />
      <RequiredFreeUsdcTile />
    </div>
  );
}
