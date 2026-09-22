"use client";

import { useEffect, useState } from "react";
import { indexerConfigured } from "../lib/indexerApi";

export interface IndexerQuery<T> {
  data: T | null;
  loading: boolean;
  /**
   * The indexer is configured but did not answer with something usable. The UI
   * says so and keeps working off its RPC polls; it never guesses the data.
   */
  degraded: boolean;
  /** No `NEXT_PUBLIC_INDEXER_URL` at all — the Fair behaviour, not a failure. */
  configured: boolean;
}

/**
 * One-shot read of an indexer route. Deliberately not polled: this is history
 * and inventory, not balances, and the live safety net is `usePolledAccount`,
 * which stays exactly as it was.
 *
 * ponytail: refetches only when `deps` change. Add an interval here if a screen
 * ever needs the indexer to follow the chain live.
 */
export function useIndexerQuery<T>(fetcher: () => Promise<T | null>, deps: unknown[]): IndexerQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(indexerConfigured);

  useEffect(() => {
    if (!indexerConfigured) return;
    let live = true;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (live) setData(result);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, degraded: indexerConfigured && !loading && data === null, configured: indexerConfigured };
}
