import { ColorType, CrosshairMode, type DeepPartial, type ChartOptions } from "lightweight-charts";

export interface ChartTokens {
  bg: string;
  surface: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  fontMono: string;
}

/**
 * The chart reads the same custom properties every other surface uses, at
 * mount, from `tokens.css`. No color is written here — if BRAND-SYSTEM.md
 * changes a token, the chart follows without an edit.
 */
export function readChartTokens(): ChartTokens {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: read("--color-bg"),
    surface: read("--color-surface"),
    border: read("--color-border"),
    textPrimary: read("--color-text-primary"),
    textMuted: read("--color-text-muted"),
    fontMono: read("--font-mono"),
  };
}

/**
 * Axis labels are compact ("2.21B") so the price scale does not eat a phone
 * screen; the figure caption and the inventory strip carry exact integers.
 */
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
export const compactInteger = (v: number) => compact.format(Math.round(v));

/** Solid surface, 1px-border grid, mono axis labels, no vendor logo. */
export function chartOptions(t: ChartTokens): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: t.surface },
      textColor: t.textMuted,
      fontFamily: t.fontMono,
      fontSize: 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: t.border },
      horzLines: { color: t.border },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: t.textMuted, labelBackgroundColor: t.bg },
      horzLine: { color: t.textMuted, labelBackgroundColor: t.bg },
    },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border, timeVisible: false, secondsVisible: false },
    handleScroll: { vertTouchDrag: false },
  };
}
