"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CLUSTER } from "../lib/constants";
import {
  LOCALNET_FUNDED_WALLET,
  localnetFundingStatus,
  type LocalnetFundingStatus,
} from "../lib/localnetFunding";

/** Localnet fixture-funding status for the connected wallet. Always "n/a" on devnet. */
export function useLocalnetFunding(): {
  status: LocalnetFundingStatus;
  fundedWallet: string | null;
} {
  const { publicKey } = useWallet();
  return {
    status: localnetFundingStatus({
      cluster: CLUSTER,
      fundedWallet: LOCALNET_FUNDED_WALLET,
      connectedWallet: publicKey?.toBase58() ?? null,
    }),
    fundedWallet: LOCALNET_FUNDED_WALLET,
  };
}
