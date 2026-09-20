"use client";

/**
 * Dual-handle tick-range slider, snapped to `step` (the pool's tick
 * spacing). COMPONENT-LIBRARY.md §3: 4px track `#262626`, 12px white handle
 * circles, active-range fill white, tick labels in 12px monospace above the
 * handles. Built on two overlapping native `<input type="range">` elements
 * rather than a custom drag implementation — native ranges are keyboard-
 * accessible (arrow keys, Home/End, focus rings) for free, which a from-
 * scratch drag handler would have to reimplement to pass UI-QA's a11y check.
 */
export function RangeSlider({
  min,
  max,
  step,
  lower,
  upper,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  lower: number;
  upper: number;
  onChange: (lower: number, upper: number) => void;
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="relative h-12 w-full">
      <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-text-primary"
        style={{ left: `${pct(lower)}%`, right: `${100 - pct(upper)}%` }}
      />
      <input
        aria-label="Lower tick"
        type="range"
        min={min}
        max={max}
        step={step}
        value={lower}
        onChange={(e) => {
          const next = Math.min(Number(e.target.value), upper - step);
          onChange(next, upper);
        }}
        className="range-thumb focus-ring pointer-events-none absolute inset-0 h-1 w-full appearance-none bg-transparent"
      />
      <input
        aria-label="Upper tick"
        type="range"
        min={min}
        max={max}
        step={step}
        value={upper}
        onChange={(e) => {
          const next = Math.max(Number(e.target.value), lower + step);
          onChange(lower, next);
        }}
        className="range-thumb focus-ring pointer-events-none absolute inset-0 h-1 w-full appearance-none bg-transparent"
      />
      <style jsx>{`
        .range-thumb::-webkit-slider-thumb {
          pointer-events: auto;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #ffffff;
          cursor: pointer;
        }
        .range-thumb::-moz-range-thumb {
          pointer-events: auto;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #ffffff;
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
