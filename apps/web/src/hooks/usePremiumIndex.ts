"use client";

import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { fetchPremiumIndex } from "../lib/accounts";
import { premiumIndexPda } from "../lib/pda";
import { useChainStore } from "../store/useChainStore";

const POLL_MS = 15_000;

/**
 * `GlobalPremiumIndex` for the market — polled every 15s. Used by
 * `lib/solvency.ts`'s `projectedIndex` for the live preflight; the account
 * may not exist yet on a fresh ledger (no long has ever minted), which is
 * fine — see `lib/perma.ts`'s withdraw builder and the Rust program's own
 * handling of the same case.
 */
export function usePremiumIndex() {
  const program = usePermaProgram();
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setPremiumIndex = useChainStore((s) => s.setPremiumIndex);

  usePolledAccount(
    async () => {
      if (!marketPubkey) return;
      const [pda] = premiumIndexPda(marketPubkey);
      const idx = await fetchPremiumIndex(program, pda);
      setPremiumIndex(idx);
    },
    POLL_MS,
    [program, marketPubkey?.toBase58()]
  );
}
