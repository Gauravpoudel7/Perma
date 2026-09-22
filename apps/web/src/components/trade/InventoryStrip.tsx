"use client";

import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useRangeStateValue } from "../../hooks/useRangeState";
import { tickToPrice } from "../../lib/whirlpool";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * Live inventory for the range the ticket has selected — the same
 * `RangePremiumState` read `SizeInput` gates on, shown as three figures.
 * This is PERMA short and long liquidity minted in one tick range. It is
 * not order-book depth; PERMA has no order book. A range no short has ever
 * opened has no account, and its liquidity really is zero.
 */
export function InventoryStrip() {
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const rangeState = useRangeStateValue(tickLower, tickUpper);

  const short = rangeState ? BigInt(rangeState.totalShortLiquidity.toString()) : 0n;
  const long = rangeState ? BigInt(rangeState.totalLongLiquidity.toString()) : 0n;
  const available = short - long;

  const low = tickToPrice(tickLower, DECIMALS_A, DECIMALS_B).toFixed(2);
  const high = tickToPrice(tickUpper, DECIMALS_A, DECIMALS_B).toFixed(2);

  return (
    <section aria-label="Inventory in the selected range" className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-overline text-text-muted">Inventory · selected range</h2>
        <p className="text-mono-sm tabular-nums text-text-muted">
          {low}–{high} USDC/SOL · ticks {tickLower} to {tickUpper}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Figure label="Short liquidity" value={short.toString()} />
        <Figure label="Long liquidity" value={long.toString()} />
        <Figure label="Available" value={available.toString()} emphasis />
      </dl>
      {short === 0n && (
        <p className="text-body-sm mt-3 text-text-muted">
          No short liquidity in this range. A long needs existing short liquidity to open against.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className={`text-mono-md tabular-nums truncate sm:mt-1 ${emphasis ? "text-text-primary" : "text-text-muted"}`}>
        {value}
      </dd>
    </div>
  );
}
