"use client";

import { useEffect } from "react";
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
  const setCollateralLoaded = useChainStore((s) => s.setCollateralLoaded);
  const owner = publicKey?.toBase58();

  // A wallet switch must not show the previous wallet's collateral as "loaded"
  // for the ~1 RPC round-trip until the new fetch lands.
  useEffect(() => {
    setUserCollateral(null);
    setCollateralLoaded(false);
  }, [owner, setUserCollateral, setCollateralLoaded]);

  usePolledAccount(
    async () => {
      if (!publicKey || !marketPubkey) {
        setUserCollateral(null);
        setCollateralLoaded(false);
        return;
      }
      const [pda] = userCollateralPda(marketPubkey, publicKey);
      const uc = await fetchUserCollateral(program, pda);
      setUserCollateral(uc);
      setCollateralLoaded(true);
    },
    POLL_MS,
    [program, owner, marketPubkey?.toBase58()]
  );
}
