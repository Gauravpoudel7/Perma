"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { fetchAllPositionsForOwner } from "../lib/accounts";
import { useChainStore } from "../store/useChainStore";

const POLL_MS = 15_000;

/**
 * Every PermaPosition (short or long, any status) for the connected wallet
 * on the current market — polled every 15s. Portfolio filters to
 * Open/PendingPremium for display; Trade/Vault use `selectOpenLongs` on this
 * same list for the exact `remainingAccounts` payload the on-chain gate
 * requires.
 */
export function usePositions() {
  const program = usePermaProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setPositions = useChainStore((s) => s.setPositions);

  usePolledAccount(
    async () => {
      if (!publicKey || !marketPubkey) {
        setPositions([]);
        return;
      }
      const positions = await fetchAllPositionsForOwner(
        program,
        connection,
        marketPubkey,
        publicKey
      );
      setPositions(positions);
    },
    POLL_MS,
    [program, connection, publicKey?.toBase58(), marketPubkey?.toBase58()]
  );
}
