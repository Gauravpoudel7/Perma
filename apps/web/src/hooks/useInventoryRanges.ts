"use client";

import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { useChainStore } from "../store/useChainStore";
import { toInventoryRanges } from "../lib/inventory";

const POLL_MS = 20_000;

/**
 * Every `RangePremiumState` for this market, read straight from the chain with
 * Anchor's `.all()` (which prepends the account discriminator to the memcmp —
 * see the note in `lib/accounts.ts` about why a raw `getProgramAccounts` is
 * wrong here). The indexer is not involved: this list is what makes the range
 * picker work on a cluster where nobody hosts one.
 *
 * Display-only, like every other poll in this app. Opening a position re-reads
 * the range it touches through `useSendPermaTx`.
 */
export function useInventoryRanges() {
  const program = usePermaProgram();
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setInventoryRanges = useChainStore((s) => s.setInventoryRanges);

  usePolledAccount(
    async () => {
      if (!marketPubkey) return;
      const accounts = await program.account.rangePremiumState.all([
        { memcmp: { offset: 8, bytes: marketPubkey.toBase58() } },
      ]);
      setInventoryRanges(toInventoryRanges(accounts.map((a) => a.account as never)));
    },
    POLL_MS,
    [program, marketPubkey?.toBase58()]
  );

  return useChainStore((s) => s.inventoryRanges);
}
