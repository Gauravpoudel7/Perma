"use client";

import { useSpotPrice } from "../../hooks/useSpotPrice";
import { useChainStore } from "../../store/useChainStore";
import { sqrtPriceX64ToPrice } from "../../lib/whirlpool";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * "SOL/USDC · Orca Whirlpool" (verbatim). The price is always labeled
 * "Spot" — Orca Whirlpool has no TWAP, and this app never implies one.
 */
export function MarketHeader() {
  useSpotPrice();
  const spot = useChainStore((s) => s.spot);

  const price = spot ? sqrtPriceX64ToPrice(spot.sqrtPriceX64, DECIMALS_A, DECIMALS_B) : null;

  return (
    <div className="flex items-center justify-between">
      <h2 className="text-h3 text-text-primary">SOL/USDC · Orca Whirlpool</h2>
      <p className="text-mono-md tabular-nums text-text-muted">
        Spot: {price !== null ? price.toFixed(4) : "—"} USDC
      </p>
    </div>
  );
}
