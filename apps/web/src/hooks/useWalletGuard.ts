"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useClusterMismatch } from "../components/wallet/ClusterGuard";
import { useChainStore } from "../store/useChainStore";

export interface WalletGuardResult {
  canTransact: boolean;
  reason: string | null;
}

/**
 * The shared "can this CTA even be pressed" check every write-path button
 * runs before its own screen-specific gates (inventory, solvency). A doomed
 * transaction — disconnected wallet, wrong cluster, unreachable RPC, or a
 * paused market blocking a NEW position — is never submitted; the button
 * disables instead, per the plan's OpenPositionButton spec.
 *
 * `allowWhilePaused` is true for Close/Settle actions — COPY-DECK: "Trading
 * is paused. Open positions can still be closed."
 */
export function useWalletGuard(opts?: { allowWhilePaused?: boolean }): WalletGuardResult {
  const { connected } = useWallet();
  const mismatch = useClusterMismatch();
  const connectionStatus = useChainStore((s) => s.connectionStatus);
  const market = useChainStore((s) => s.market);

  if (!connected) return { canTransact: false, reason: "Connect a wallet to continue." };
  if (connectionStatus === "unreachable") {
    return { canTransact: false, reason: "Can't reach the network. Displayed values may be stale." };
  }
  if (mismatch) {
    return { canTransact: false, reason: "PERMA runs on devnet. Switch your wallet's network to continue." };
  }
  if (market?.isPaused && !opts?.allowWhilePaused) {
    return { canTransact: false, reason: "Trading is paused. Open positions can still be closed." };
  }
  return { canTransact: true, reason: null };
}
