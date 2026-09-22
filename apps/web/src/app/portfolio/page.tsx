"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { HistoryTable } from "../../components/portfolio/HistoryTable";
import { PositionsTable } from "../../components/portfolio/PositionsTable";
import { EmptyState } from "../../components/primitives/States";
import { useChainStore } from "../../store/useChainStore";
import { STATUS_CLOSED } from "../../lib/constants";

export default function PortfolioPage() {
  const { connected } = useWallet();
  const positions = useChainStore((s) => s.positions);
  const liveCount = positions.filter((p) => p.status !== STATUS_CLOSED).length;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-h3 text-text-primary">Your Positions</h1>
          {connected && <span className="text-mono-md tabular-nums text-text-muted">({liveCount})</span>}
        </div>
        {connected ? <PositionsTable positions={positions} /> : <EmptyState>Connect a wallet to continue.</EmptyState>}
      </section>
      {connected && (
        <section>
          <h2 className="text-h4 mb-4 text-text-primary">History</h2>
          <HistoryTable />
        </section>
      )}
    </div>
  );
}
