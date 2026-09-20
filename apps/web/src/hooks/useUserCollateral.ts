"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { fetchUserCollateral } from "../lib/accounts";
import { userCollateralPda } from "../lib/pda";
import { useChainStore } from "../store/useChainStore";

const POLL_MS = 15_000;

/** `UserCollateral` for the connected wallet — polled every 15s. */
export function useUserCollateral() {
  const program = usePermaProgram();
  const { publicKey } = useWallet();
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setUserCollateral = useChainStore((s) => s.setUserCollateral);

  usePolledAccount(
    async () => {
      if (!publicKey || !marketPubkey) {
        setUserCollateral(null);
        return;
      }
      const [pda] = userCollateralPda(marketPubkey, publicKey);
      const uc = await fetchUserCollateral(program, pda);
      setUserCollateral(uc);
    },
    POLL_MS,
    [program, publicKey?.toBase58(), marketPubkey?.toBase58()]
  );
}
