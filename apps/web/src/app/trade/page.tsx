"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { TradePanel } from "../../components/trade/TradePanel";

export default function TradePage() {
  const { connected } = useWallet();

  return connected ? (
    <TradePanel />
  ) : (
    <div className="mx-auto max-w-xl text-center">
      <p className="text-body-md text-text-muted">Connect a wallet to continue.</p>
    </div>
  );
}
