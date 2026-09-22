"use client";

import { NumberInput } from "../primitives/NumberInput";
import { InventoryEmptyState } from "./InventoryEmptyState";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useRangeStateValue } from "../../hooks/useRangeState";

/**
 * "Position Size", in raw Orca liquidity units (matching the on-chain
 * `liquidity: u128` field — not a token amount). On LONG, checks the live
 * `available = totalShort - totalLong` for the selected range and swaps in
 * `InventoryEmptyState` when it's zero, per the plan's honesty override.
 */
export function SizeInput() {
  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const sizeInput = useTradeFormStore((s) => s.sizeInput);
  const setSizeInput = useTradeFormStore((s) => s.setSizeInput);
  const rangeState = useRangeStateValue(tickLower, tickUpper);

  if (side === "long") {
    const available = rangeState
      ? BigInt(rangeState.totalShortLiquidity.toString()) -
        BigInt(rangeState.totalLongLiquidity.toString())
      : 0n;
    if (available <= 0n) {
      return (
        <div>
          <p className="text-body-sm mb-2 block text-text-muted">Position Size</p>
          <InventoryEmptyState />
        </div>
      );
    }
    return (
      <div>
        <label htmlFor="position-size" className="text-body-sm mb-2 block text-text-muted">
          Position Size
        </label>
        <NumberInput
          id="position-size"
          placeholder="Liquidity units"
          value={sizeInput}
          onChange={(e) => setSizeInput(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <p className="text-body-sm mt-1 text-text-muted">
          Available in this range: {available.toString()}
        </p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="position-size" className="text-body-sm mb-2 block text-text-muted">
        Position Size
      </label>
      <NumberInput
        id="position-size"
        placeholder="Liquidity units"
        value={sizeInput}
        onChange={(e) => setSizeInput(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
}
