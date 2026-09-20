"use client";

import { PositionsTable } from "../../components/portfolio/PositionsTable";
import { useChainStore } from "../../store/useChainStore";
import { useWallet } from "@solana/wallet-adapter-react";

export default function PortfolioPage() {
  const { connected } = useWallet();
  const positions = useChainStore((s) => s.positions);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-h2 mb-6 text-text-primary">Your Positions</h1>
      {!connected ? (
        <p className="text-body-md text-text-muted">Connect a wallet to continue.</p>
      ) : (
        <PositionsTable positions={positions} />
      )}
    </div>
  );
}
