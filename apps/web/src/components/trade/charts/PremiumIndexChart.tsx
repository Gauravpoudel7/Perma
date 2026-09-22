"use client";

import { useEffect, useRef } from "react";
import { LineSeries, LineStyle, type Time } from "lightweight-charts";
import { useLwcChart } from "./useLwcChart";
import { compactInteger as integer } from "./theme";
import { toPremiumLineData } from "./series";
import type { PremiumPoint } from "../../../lib/indexerApi";

const slotLabel = (t: Time) => `slot ${typeof t === "number" ? t : String(t)}`;

/**
 * The global premium index over slots, from `/premium/series`. One line, one
 * dot per recorded value (the dots are the data; the line between them is a
 * connector). `liveIndex` is the current `GlobalPremiumIndex` read over RPC,
 * drawn as a dashed reference line so an indexer that lags is visibly behind.
 */
export function PremiumIndexChart({ points, liveIndex }: { points: PremiumPoint[]; liveIndex: bigint | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { chart, tokens } = useLwcChart(ref, {
    timeScale: { tickMarkFormatter: slotLabel },
    localization: { timeFormatter: slotLabel, priceFormatter: integer },
  });

  useEffect(() => {
    if (!chart || !tokens) return;
    const series = chart.addSeries(LineSeries, {
      color: tokens.textPrimary,
      lineWidth: 1,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
      priceLineVisible: false,
      // The dashed RPC line carries the axis label; a second label at the same value just overlaps it.
      lastValueVisible: liveIndex === null,
      priceFormat: { type: "custom", minMove: 1, formatter: integer },
    });
    series.setData(toPremiumLineData(points));
    if (liveIndex !== null) {
      series.createPriceLine({
        price: Number(liveIndex),
        color: tokens.textMuted,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Live index (RPC)",
      });
    }
    chart.timeScale().fitContent();
    return () => {
      // On route change useLwcChart may already have called chart.remove();
      // removeSeries then throws "Value is undefined" inside lightweight-charts.
      try {
        chart.removeSeries(series);
      } catch {
        /* chart already disposed */
      }
    };
  }, [chart, tokens, points, liveIndex]);

  return <div ref={ref} className="h-56 w-full" role="img" aria-label="Premium index over slots" />;
}
