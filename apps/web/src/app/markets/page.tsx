"use client";

import Link from "next/link";
import { useMarket } from "../../hooks/useMarket";
import { useIndexerQuery } from "../../hooks/useIndexer";
import { fetchMarkets, type IndexerMarket } from "../../lib/indexerApi";
import { useChainStore } from "../../store/useChainStore";
import { truncateAddress } from "../../lib/format";
import { Badge } from "../../components/primitives/Badge";
import { DegradedState, InlineError, Skeleton } from "../../components/primitives/States";

/**
 * PERMA is single-pool: one allowlisted Whirlpool, one Market. This page exists
 * to make that explicit rather than to imply a catalogue — and it shows where
 * each row came from, because an indexer row can be stale in a way an RPC read
 * cannot. No TVL, no volume, no user counts: none of those exist on-chain here.
 */
export default function MarketsPage() {
  const { marketPubkey } = useMarket();
  const market = useChainStore((s) => s.market);
  const { data, loading, degraded } = useIndexerQuery(fetchMarkets, []);

  const fromRpc: IndexerMarket | null =
    market && marketPubkey
      ? {
          market: marketPubkey.toBase58(),
          whirlpool: market.whirlpool.toBase58(),
          isPaused: market.isPaused,
          tickSpacing: market.tickSpacing,
          premiumRate: market.premiumRate.toString(),
          premiumMultiplier: market.premiumMultiplier.toString(),
          snapshotSlot: 0,
        }
      : null;

  const rows = data?.markets ?? (fromRpc ? [fromRpc] : []);
  const source = data ? "Indexer" : fromRpc ? "RPC" : null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-h2 mb-2 text-text-primary">Markets</h1>
      <p className="text-body-sm mb-6 text-text-muted">
        One allowlisted Orca Whirlpool. Prototype. Not audited. Single pool. Not production
        mainnet risk capital.
      </p>

      {rows.length === 0 ? (
        loading ? (
          <Skeleton className="h-40" />
        ) : (
          <InlineError>No market data available. Check the RPC connection.</InlineError>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((m) => (
            <div key={m.market} className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-h3 text-text-primary">SOL/USDC · Orca Whirlpool</h2>
                {m.isPaused === null ? null : (
                  <Badge tone={m.isPaused ? "warning" : "neutral"}>{m.isPaused ? "Paused" : "Open"}</Badge>
                )}
              </div>
              <dl className="text-mono-md mt-3 grid grid-cols-1 gap-x-6 gap-y-1 tabular-nums text-text-muted sm:grid-cols-2">
                <div className="flex justify-between">
                  <dt>Market</dt>
                  <dd>{truncateAddress(m.market, 6)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Whirlpool</dt>
                  <dd>{truncateAddress(m.whirlpool, 6)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Tick spacing</dt>
                  <dd>{m.tickSpacing ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Premium rate</dt>
                  <dd>{m.premiumRate ?? "—"}</dd>
                </div>
              </dl>
              <Link
                href="/trade"
                className="transition-brand focus-ring text-body-md mt-4 inline-block rounded-md px-3 py-2 text-text-primary underline"
              >
                Trade this market
              </Link>
            </div>
          ))}
        </div>
      )}

      {source ? (
        <p className="text-body-sm mt-4 text-text-muted">
          Source: {source}
          {data ? ` · indexed through slot ${data.watermark.slot}` : ""}
        </p>
      ) : null}
      {degraded ? (
        <div className="mt-4">
          <DegradedState>
            The indexer is not responding. This page is showing live RPC reads instead.
          </DegradedState>
        </div>
      ) : null}
    </div>
  );
}
