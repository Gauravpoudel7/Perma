"use client";

import { useEffect, useState, type RefObject } from "react";
import { createChart, type DeepPartial, type ChartOptions, type IChartApi } from "lightweight-charts";
import { chartOptions, readChartTokens, type ChartTokens } from "./theme";

/**
 * One Lightweight Charts instance bound to a container. Created after mount
 * (this module is only ever loaded through `next/dynamic` with `ssr: false`),
 * sized by the library's own ResizeObserver (`autoSize`), and removed on
 * unmount so a route change never leaks a canvas or an observer.
 *
 * Teardown is defensive: a pending LWC autoSize / our fitContent RO can still
 * fire after `chart.remove()` (Object is disposed / Value is undefined). A
 * disposed flag + try/catch keeps route changes from crashing Portfolio/Vault.
 */
export function useLwcChart(
  containerRef: RefObject<HTMLDivElement>,
  extra: DeepPartial<ChartOptions> = {}
): { chart: IChartApi | null; tokens: ChartTokens | null } {
  const [state, setState] = useState<{ chart: IChartApi; tokens: ChartTokens } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    const tokens = readChartTokens();
    const chart = createChart(el, { ...chartOptions(tokens), ...extra });

    // A pane can mount hidden (the phone "Market data" disclosure) — then the
    // first fitContent ran at 0px width. Refit whenever the box gets a real width.
    const ro = new ResizeObserver((entries) => {
      if (disposed) return;
      if (!entries.some((e) => e.contentRect.width > 0)) return;
      try {
        chart.timeScale().fitContent();
      } catch {
        /* chart already disposed */
      }
    });
    ro.observe(el);
    setState({ chart, tokens });

    return () => {
      disposed = true;
      ro.disconnect();
      // Stop LWC's own autoSize from scheduling another paint on a dead canvas.
      try {
        chart.applyOptions({ autoSize: false });
      } catch {
        /* already disposed */
      }
      try {
        chart.remove();
      } catch {
        /* already disposed */
      }
      // Drop the React handle so series effects cannot call into a dead chart
      // on a remount race. On pure unmount this is a no-op.
      setState(null);
    };
    // `extra` is treated as mount-time configuration; series components pass a stable literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  return { chart: state?.chart ?? null, tokens: state?.tokens ?? null };
}
