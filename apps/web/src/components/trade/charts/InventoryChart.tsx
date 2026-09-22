"use client";

import { useEffect, useRef } from "react";
import { HistogramSeries, createSeriesMarkers, type Time, type UTCTimestamp } from "lightweight-charts";
import { useLwcChart } from "./useLwcChart";
import { compactInteger as integer } from "./theme";
import { toInventoryHistogramData } from "./series";
import type { RangeBucket } from "../../../lib/indexerApi";
import { useTradeFormStore } from "../../../store/useTradeFormStore";


/**
 * Short and long liquidity per tick range, from the indexed market detail.
 * Short bars first (muted), long bars on top (primary) — a long never exceeds
 * its range's short, so the nested bar reads as "how much is taken". The
 * arrow marks the range the ticket currently has selected: each bar is one
 * tick range, so this is a direct mapping, not a projection.
 */
export function InventoryChart({
  buckets,
  selected,
}: {
  buckets: RangeBucket[];
  selected: { tickLower: number; tickUpper: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<string[]>([]);
  const setRange = useTradeFormStore((s) => s.setRange);
  // Latest buckets for the click handler, without resubscribing every render.
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;
  const label = (t: Time) => labelsRef.current[Number(t) - 1] ?? "";
  const { chart, tokens } = useLwcChart(ref, {
    timeScale: { tickMarkFormatter: label, minBarSpacing: 24 },
    localization: { timeFormatter: label, priceFormatter: integer },
    handleScale: false,
    handleScroll: false,
    // Headroom for the "Selected range" marker above the tallest bar.
    rightPriceScale: { scaleMargins: { top: 0.3, bottom: 0 } },
  });

  useEffect(() => {
    if (!chart || !tokens) return;
    const data = toInventoryHistogramData(buckets, selected, {
      short: tokens.textMuted,
      long: tokens.textPrimary,
    });
    labelsRef.current = data.labels;
    const common = {
      base: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "custom" as const, minMove: 1, formatter: integer },
    };
    const short = chart.addSeries(HistogramSeries, { ...common, color: tokens.textMuted });
    const long = chart.addSeries(HistogramSeries, { ...common, color: tokens.textPrimary });
    short.setData(data.short);
    long.setData(data.long);
    const markers = createSeriesMarkers(
      short,
      data.selectedIndex === null
        ? []
        : [
            {
              time: (data.selectedIndex + 1) as UTCTimestamp,
              position: "aboveBar",
              shape: "arrowDown",
              color: tokens.textPrimary,
              text: "Selected range",
            },
          ]
    );
    // Clicking a bar selects that tick range on the ticket. A mouse shortcut for
    // what `InventoryPicker` does with the keyboard — never the only way in.
    const onClick = (param: { time?: Time }) => {
      if (param.time === undefined) return;
      const bucket = bucketsRef.current[Number(param.time) - 1];
      if (bucket) setRange(bucket.tickLower, bucket.tickUpper, "inventory");
    };
    chart.subscribeClick(onClick);
    chart.timeScale().fitContent();
    return () => {
      try {
        chart.unsubscribeClick(onClick);
        markers.detach();
        chart.removeSeries(short);
        chart.removeSeries(long);
      } catch {
        /* chart already disposed by useLwcChart on unmount */
      }
    };
  }, [chart, tokens, buckets, selected, setRange]);

  return <div ref={ref} className="h-40 w-full" role="img" aria-label="Short and long liquidity by tick range" />;
}
