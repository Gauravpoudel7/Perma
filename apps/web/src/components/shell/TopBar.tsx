"use client";

import { ConnectButton } from "../wallet/ConnectButton";
import { Badge } from "../primitives/Badge";
import { useChainStore } from "../../store/useChainStore";
import { formatBaseUnits } from "../../lib/format";

/** APP-SHELL.md Top Bar: wallet connect, balance, market status. */
export function TopBar() {
  const market = useChainStore((s) => s.market);
  const userCollateral = useChainStore((s) => s.userCollateral);

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-4">
      <div className="flex items-center gap-4">
        <p className="text-h4 text-text-primary">PERMA</p>
        {market && (
          <Badge tone={market.isPaused ? "warning" : "neutral"}>
            {market.isPaused ? "Paused" : "Active"}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-4">
        {userCollateral && (
          <p className="text-mono-sm tabular-nums text-text-muted">
            {formatBaseUnits(BigInt(userCollateral.balanceB.toString()), 6, 2)} USDC
          </p>
        )}
        <ConnectButton />
      </div>
    </header>
  );
}
