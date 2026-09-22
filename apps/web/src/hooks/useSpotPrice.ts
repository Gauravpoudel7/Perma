"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { usePolledAccount } from "./usePolledAccount";
import { decodeWhirlpoolSpot } from "../lib/whirlpool";
import { WHIRLPOOL } from "../lib/constants";
import { useChainStore } from "../store/useChainStore";

const POLL_MS = 10_000;

/**
 * Whirlpool spot price, mounted once in AppShell for the TopBar ticker.
 * Labeled "Spot" always; there is no TWAP to show and none is computed
 * here. Polled every 10s. No transaction path reads it.
 */
export function useSpotPrice() {
  const { connection } = useConnection();
  const setSpot = useChainStore((s) => s.setSpot);

  usePolledAccount(
    async () => {
      const info = await connection.getAccountInfo(WHIRLPOOL);
      if (!info) {
        setSpot(null);
        return;
      }
      setSpot(decodeWhirlpoolSpot(info.data));
    },
    POLL_MS,
    [connection]
  );
}
