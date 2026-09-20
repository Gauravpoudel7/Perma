"use client";

import { useChainStore, selectOpenLongs } from "../store/useChainStore";

/**
 * DISPLAY-only view of the owner's open longs, from the polled store. NEVER
 * use this list to build a transaction's `remainingAccounts` — the store can
 * be up to 15s stale, and a stale list fails `MissingOpenLong`. Write flows
 * (`useSendPermaTx`) always re-fetch fresh via `fetchOpenLongsForOwner`
 * immediately before building the instruction.
 */
export function useOpenLongs() {
  return useChainStore(selectOpenLongs);
}
