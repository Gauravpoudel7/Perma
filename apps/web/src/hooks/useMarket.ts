"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { fetchMarket } from "../lib/accounts";
import { marketPda } from "../lib/pda";
import { WHIRLPOOL } from "../lib/constants";
import { useChainStore } from "../store/useChainStore";

const POLL_MS = 30_000;

/** `Market` (premium/risk params, is_paused, vaults, mints) — polled every 30s. */
export function useMarket() {
  const program = usePermaProgram();
  const { connection } = useConnection();
  const setMarket = useChainStore((s) => s.setMarket);
  const setMarketPubkey = useChainStore((s) => s.setMarketPubkey);

  const [market] = marketPda(WHIRLPOOL);

  usePolledAccount(
    async () => {
      setMarketPubkey(market);
      const m = await fetchMarket(program, market);
      setMarket(m);
    },
    POLL_MS,
    [program, connection, market.toBase58()]
  );

  return { marketPubkey: market };
}
