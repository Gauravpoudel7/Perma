"use client";

import { useState } from "react";
import { useInventoryRanges } from "../../hooks/useInventoryRanges";
import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { bestAvailableRange, sortRangesForPicker, type InventoryRange } from "../../lib/inventory";
import { tickToPrice } from "../../lib/whirlpool";

const DECIMALS_A = 9;
const DECIMALS_B = 6;
/** Rows shown before "Show all". The list scrolls either way; this keeps the first view short. */
const PICKER_VISIBLE_ROWS = 8;

/**
 * Pick the ticket's range from the ranges that actually hold short liquidity.
 *
 * A long can only open against shorts in the *same* tick range, and the spot
 * presets cannot land on one by luck. Each row writes that range's exact ticks
 * into the trade form — never a nearby preset, never a merged band — so the
 * range the user sees is the range the transaction carries. Rows are native
 * buttons, so keyboard activation and focus rings come for free.
 *
 * The list is a live RPC read of every `RangePremiumState` for this market
 * (`useInventoryRanges`), not indexed data: it has to work on a cluster where
 * no indexer is hosted. This is inventory, not order-book depth.
 *
 * On the short side the rows start collapsed — a short is provisioning new
 * liquidity, not consuming someone else's — but "Use available short" stays
 * reachable for matching an existing band.
 */
export function InventoryPicker() {
  const ranges = useInventoryRanges();
  const spot = useChainStore((s) => s.spot);
  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const setRange = useTradeFormStore((s) => s.setRange);
  const [showAll, setShowAll] = useState(false);
  const [openOnShort, setOpenOnShort] = useState(false);

  const currentTick = spot?.tickCurrentIndex ?? null;
  const withShorts = sortRangesForPicker(
    ranges.filter((r) => r.shortLiquidity > 0n),
    currentTick
  );
  const best = bestAvailableRange(ranges, currentTick);
  const expanded = side === "long" || openOnShort;
  const rows = showAll ? withShorts : withShorts.slice(0, PICKER_VISIBLE_ROWS);

  function select(r: InventoryRange) {
    setRange(r.tickLower, r.tickUpper, "inventory");
  }

  return (
    <section aria-label="Ranges with short liquidity" className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {side === "long" ? (
          <h2 className="text-overline text-text-muted">
            Open against existing shorts{" "}
            <span className="tabular-nums">({withShorts.length})</span>
          </h2>
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="inventory-picker-rows"
            onClick={() => setOpenOnShort((v) => !v)}
            className="transition-brand focus-ring text-overline flex min-h-[44px] items-center gap-2 rounded-sm text-text-muted hover:text-text-primary"
          >
            <span>
              Ranges with short liquidity <span className="tabular-nums">({withShorts.length})</span>
            </span>
            <span className="text-caption">{expanded ? "Hide" : "Show"}</span>
          </button>
        )}
        <button
          type="button"
          disabled={!best}
          onClick={() => best && select(best)}
          className="transition-brand focus-ring text-body-sm rounded-sm border border-border px-3 py-2 text-text-primary hover:border-text-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-40"
          title={best ? undefined : "No range has short liquidity left to open against."}
        >
          Use available short
        </button>
      </div>

      {withShorts.length === 0 ? (
        <p className="text-body-sm mt-3 text-text-muted">
          No short liquidity in this range. A long needs existing short liquidity to open against.
        </p>
      ) : (
        <div id="inventory-picker-rows" className={expanded ? "" : "hidden"}>
          <ul data-testid="inventory-rows" className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
            {rows.map((r) => {
              const active = r.tickLower === tickLower && r.tickUpper === tickUpper;
              return (
                <li key={`${r.tickLower}:${r.tickUpper}`}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(r)}
                    className={`transition-brand focus-ring flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm border px-3 py-2 text-left ${
                      active ? "border-text-primary bg-bg" : "border-transparent hover:border-border"
                    }`}
                  >
                    <span className="text-mono-sm tabular-nums text-text-primary">
                      {tickToPrice(r.tickLower, DECIMALS_A, DECIMALS_B).toFixed(2)}–
                      {tickToPrice(r.tickUpper, DECIMALS_A, DECIMALS_B).toFixed(2)} USDC/SOL
                    </span>
                    <span className="text-mono-sm tabular-nums text-text-muted">
                      ticks {r.tickLower} to {r.tickUpper}
                    </span>
                    <span className="text-mono-sm tabular-nums text-text-primary">
                      {r.available.toString()} available
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {withShorts.length > PICKER_VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="transition-brand focus-ring text-body-sm mt-2 rounded-sm px-1 py-2 text-text-muted underline underline-offset-2 hover:text-text-primary"
            >
              {showAll ? "Show fewer" : `Show all (${withShorts.length})`}
            </button>
          )}
        </div>
      )}
      <p className="text-body-sm mt-3 text-text-muted">
        Short and long liquidity minted in each tick range, read from the chain. Picking a row sets the
        ticket to exactly those ticks.
      </p>
    </section>
  );
}
