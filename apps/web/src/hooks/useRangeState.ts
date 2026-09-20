"use client";

import { usePermaProgram } from "./usePermaProgram";
import { usePolledAccount } from "./usePolledAccount";
import { fetchRangeState } from "../lib/accounts";
import { rangeStatePda } from "../lib/pda";
import { useChainStore, selectRangeState } from "../store/useChainStore";

const POLL_MS = 15_000;

/**
 * `RangePremiumState` for one (tickLower, tickUpper) — polled every 15s
 * while that range is being viewed. The account may not exist yet (no short
 * has ever traded this range); `fetchRangeState` returns `null` in that
 * case, which callers read as `available = 0` (NoShortInventory territory).
 */
export function useRangeState(tickLower: number, tickUpper: number) {
  const program = usePermaProgram();
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setRangeState = useChainStore((s) => s.setRangeState);
  const rangeState = useChainStore((s) => selectRangeState(s, tickLower, tickUpper));

  usePolledAccount(
    async () => {
      if (!marketPubkey) return;
      const [pda] = rangeStatePda(marketPubkey, tickLower, tickUpper);
      const rs = await fetchRangeState(program, pda);
      if (rs) setRangeState({ tickLower, tickUpper }, rs);
    },
    POLL_MS,
    [program, marketPubkey?.toBase58(), tickLower, tickUpper]
  );

  return rangeState;
}
