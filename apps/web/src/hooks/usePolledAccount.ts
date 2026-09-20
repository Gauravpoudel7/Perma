"use client";

import { useEffect, useRef } from "react";

/**
 * Generic polling primitive: runs `fetchFn` immediately on mount / whenever
 * `deps` change, then every `intervalMs`. Every `use*` read hook in this app
 * is a thin wrapper around this — the only thing that differs per hook is
 * what gets fetched and which interval it uses (see IMPL plan §3 for the
 * per-account-type interval table).
 */
export function usePolledAccount(
  fetchFn: () => void | Promise<void>,
  intervalMs: number,
  deps: React.DependencyList
) {
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void fetchRef.current();
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
