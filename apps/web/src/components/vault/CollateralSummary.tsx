"use client";

import Link from "next/link";
import { DataTile } from "../primitives/DataTile";
import { Skeleton } from "../primitives/States";
import { RequiredFreeUsdcTile } from "./RequiredFreeUsdcTile";
import { useChainStore } from "../../store/useChainStore";
import { formatBaseUnits } from "../../lib/format";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * Four tiles, in the order a trader reads them: what can leave now, what
 * must stay, what is held by open positions, what is in total. "Required
 * free USDC" is a real computed amount, never a "Solvency Ratio %" (no price
 * input exists to form a ratio from; see ADR-0003).
 */
export function CollateralSummary() {
  const uc = useChainStore((s) => s.userCollateral);
  const loaded = useChainStore((s) => s.collateralLoaded);

  if (!loaded) {
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Loading collateral">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!uc) {
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <DataTile label="Available to withdraw" value="—" />
        <RequiredFreeUsdcTile />
        <DataTile label="Locked by open positions" value="—" tone="muted" />
        <DataTile label="Deposited" value="—" tone="muted" />
      </div>
    );
  }

  const balanceA = BigInt(uc.balanceA.toString());
  const balanceB = BigInt(uc.balanceB.toString());
  const lockedA = BigInt(uc.lockedA.toString());
  const lockedB = BigInt(uc.lockedB.toString());
  // Two assets per tile: stacked where the tile is narrow, one line where it is wide.
  const pair = (a: bigint, b: bigint) => (
    <>
      <span className="block xl:inline">{formatBaseUnits(a, DECIMALS_A, 4)} SOL</span>
      <span className="hidden xl:inline"> / </span>
      <span className="block xl:inline">{formatBaseUnits(b, DECIMALS_B, 2)} USDC</span>
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <DataTile label="Available to withdraw" value={pair(balanceA, balanceB)} />
      <RequiredFreeUsdcTile />
      <DataTile
        label="Locked by open positions"
        value={pair(lockedA, lockedB)}
        tone="muted"
        action={
          lockedA + lockedB > 0n ? (
            <Link
              href="/portfolio"
              className="transition-brand focus-ring text-body-sm rounded-md text-text-muted underline underline-offset-2 hover:text-text-primary"
            >
              View positions
            </Link>
          ) : undefined
        }
      />
      <DataTile label="Deposited" value={pair(balanceA + lockedA, balanceB + lockedB)} tone="muted" />
    </div>
  );
}
