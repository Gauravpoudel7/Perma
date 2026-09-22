"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useIndexerQuery } from "../../hooks/useIndexer";
import { fetchMarketDetail, fetchPremiumSeries } from "../../lib/indexerApi";
import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { DegradedState, EmptyState, Skeleton } from "../primitives/States";

/**
 * Two charts from indexed rows, drawn with Lightweight Charts (canvas; the
 * modules load client-only — the library touches `window` at import time).
 *
 * Every rule here is a rule about what is NOT drawn:
 *  - A premium point is either a decoded `LongMinted.entry_index` or a live
 *    `GlobalPremiumIndex` read. Nothing is interpolated, so a gap between two
 *    points is a gap in what happened, and the line between them is only a
 *    connector, which is why every point keeps its dot.
 *  - Inventory is PERMA short and long liquidity per tick range. It is not
 *    order-book depth, there is no book, and it is never labelled as one.
 *  - Each chart renders only when there is real data for it. An empty series
 *    renders a plain sentence saying so rather than an empty axis implying a
 *    flat line. There is no demo series and no placeholder curve.
 */

const PremiumIndexChart = dynamic(
  () => import("./charts/PremiumIndexChart").then((m) => m.PremiumIndexChart),
  { ssr: false, loading: () => <Skeleton className="h-56" /> }
);
const InventoryChart = dynamic(
  () => import("./charts/InventoryChart").then((m) => m.InventoryChart),
  { ssr: false, loading: () => <Skeleton className="h-40" /> }
);

export function IndexedCharts() {
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const market = marketPubkey?.toBase58() ?? "";
  const series = useIndexerQuery(fetchPremiumSeries, []);
  const detail = useIndexerQuery(
    () => (market ? fetchMarketDetail(market) : Promise.resolve(null)),
    [market]
  );

  const points = series.data?.points ?? [];
  // A single point is a dot, not a series; two is the minimum that shows change.
  const showSeries = points.length >= 2;
  // Incomplete history means every bucket sum is too small. Hide, do not hedge.
  const buckets = useMemo(() => {
    const all = detail.data && detail.data.watermark.historyComplete ? detail.data.inventoryByRange : [];
    return all.filter((b) => BigInt(b.shortLiquidity) + BigInt(b.longLiquidity) > 0n);
  }, [detail.data]);
  const showInventory = buckets.length > 0;
  const selected = useMemo(() => ({ tickLower, tickUpper }), [tickLower, tickUpper]);
  const liveIndex = premiumIndex ? BigInt(premiumIndex.currentIndex.toString()) : null;

  if (!series.configured) {
    return <EmptyState>Charts need the indexer. Set NEXT_PUBLIC_INDEXER_URL to enable them.</EmptyState>;
  }
  if (series.loading || detail.loading) return <Skeleton className="h-40" />;
  if (!showSeries && !showInventory) {
    return series.degraded || detail.degraded ? (
      <DegradedState>The indexer is not responding. No chart is shown.</DegradedState>
    ) : (
      <EmptyState>No indexed data for this market yet.</EmptyState>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="flex flex-col gap-4">
      {showSeries && first && last ? (
        <figure className="rounded-md border border-border bg-surface p-4">
          <figcaption className="text-overline mb-2 text-text-muted">Premium index</figcaption>
          <PremiumIndexChart points={points} liveIndex={liveIndex} />
          <p className="text-body-sm mt-2 text-text-muted">
            <span className="text-mono-sm tabular-nums">{points.length}</span> recorded{" "}
            {points.length === 1 ? "value" : "values"}, slot{" "}
            <span className="text-mono-sm tabular-nums">{first.slot}</span> to{" "}
            <span className="text-mono-sm tabular-nums">{last.slot}</span>. Each dot is an index value the
            chain actually recorded — a long mint or a direct account read. The line between dots is a
            connector, not data. The dashed line is the index read over RPC right now.
          </p>
        </figure>
      ) : null}
      {showInventory ? (
        <figure className="rounded-md border border-border bg-surface p-4">
          <figcaption className="text-overline mb-2 text-text-muted">Inventory by range</figcaption>
          <InventoryChart buckets={buckets} selected={selected} />
          <p className="text-body-sm mt-2 text-text-muted">
            PERMA short (muted) and long (white) liquidity minted in each tick range. The arrow marks the
            range selected on the ticket. This is inventory, not order book depth — PERMA has no order
            book.
          </p>
        </figure>
      ) : null}
    </div>
  );
}
