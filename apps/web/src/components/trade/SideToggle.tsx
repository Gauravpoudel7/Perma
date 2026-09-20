"use client";

import { useTradeFormStore } from "../../store/useTradeFormStore";

/** COPY-DECK §4.1 side-toggle labels, verbatim. */
export function SideToggle() {
  const side = useTradeFormStore((s) => s.side);
  const setSide = useTradeFormStore((s) => s.setSide);

  return (
    <div className="flex rounded-md border border-border">
      <button
        type="button"
        onClick={() => setSide("short")}
        className={`transition-brand focus-ring flex-1 rounded-l-md px-4 py-3 text-body-md ${
          side === "short" ? "bg-text-primary text-bg" : "text-text-muted hover:text-text-primary"
        }`}
        aria-pressed={side === "short"}
      >
        Short (provide liquidity)
      </button>
      <button
        type="button"
        onClick={() => setSide("long")}
        className={`transition-brand focus-ring flex-1 rounded-r-md border-l border-border px-4 py-3 text-body-md ${
          side === "long" ? "bg-text-primary text-bg" : "text-text-muted hover:text-text-primary"
        }`}
        aria-pressed={side === "long"}
      >
        Long (buy against inventory)
      </button>
    </div>
  );
}
