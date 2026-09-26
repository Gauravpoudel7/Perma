"use client";

import { ConnectButton } from "../wallet/ConnectButton";
import { Badge } from "../primitives/Badge";
import { useChainStore } from "../../store/useChainStore";
import { formatBaseUnits } from "../../lib/format";
import { sqrtPriceX64ToPrice } from "../../lib/whirlpool";

// Demo pool: WSOL (9 decimals) / devUSDC (6 decimals).
const DECIMALS_A = 9;
const DECIMALS_B = 6;

/** COPY-DECK §4.4 paused copy, verbatim — surfaced as the badge's title. */
const PAUSED_TITLE = "Trading is paused. Open positions can still be closed.";

/**
 * APP-SHELL.md Top Bar: wordmark · market label · Spot · market status ·
 * free collateral · Connect. One dense row; the only live numbers are the
 * Orca spot read and the wallet's free (unlocked) balances, both straight
 * from RPC polls. "Spot" is never a TWAP; "Free" is never a P&L.
 */
export function TopBar() {
  const market = useChainStore((s) => s.market);
  const spot = useChainStore((s) => s.spot);
  const userCollateral = useChainStore((s) => s.userCollateral);

  const price = spot ? sqrtPriceX64ToPrice(spot.sqrtPriceX64, DECIMALS_A, DECIMALS_B) : null;

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:gap-x-4">
        <p className="text-overline text-text-primary">PERMA</p>
        <p className="text-body-sm hidden text-text-muted md:block">SOL/USDC · Orca Whirlpool</p>
        <p className="text-mono-sm tabular-nums whitespace-nowrap text-text-muted">
          <span className="text-caption">Spot </span>
          <span className="text-text-primary">{price !== null ? price.toFixed(4) : "—"}</span> USDC/SOL
        </p>
        {market && (
          // "Active" is the quiet default and is hidden on phones to keep one
          // row; "Paused" is a trading gate and is always shown.
          <span
            title={market.isPaused ? PAUSED_TITLE : undefined}
            className={market.isPaused ? "" : "hidden sm:inline-flex"}
          >
            <Badge tone={market.isPaused ? "warning" : "neutral"}>
              {market.isPaused ? "Paused" : "Active"}
            </Badge>
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {userCollateral && (
          <p className="text-mono-sm tabular-nums hidden whitespace-nowrap text-text-muted md:block">
            <span className="text-caption">Free </span>
            <span className="text-text-primary">
              {formatBaseUnits(BigInt(userCollateral.balanceA.toString()), DECIMALS_A, 4)}
            </span>{" "}
            SOL ·{" "}
            <span className="text-text-primary">
              {formatBaseUnits(BigInt(userCollateral.balanceB.toString()), DECIMALS_B, 2)}
            </span>{" "}
            USDC
          </p>
        )}
        <ConnectButton />
      </div>
    </header>
  );
}
