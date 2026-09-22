import { create } from "zustand";

/** Ephemeral Trade-screen form state — never persisted, never chain-derived. */
export type Side = "short" | "long";

/** Where the current ticks came from, so the ticket can say so. */
export type RangeSource = "default" | "manual" | "preset" | "inventory";

interface TradeFormState {
  side: Side;
  tickLower: number;
  tickUpper: number;
  sizeInput: string; // raw text; parsed to bigint at submit time
  rangeSource: RangeSource;
  setSide: (s: Side) => void;
  setRange: (tickLower: number, tickUpper: number, source?: RangeSource) => void;
  setSizeInput: (v: string) => void;
}

// Demo range default — the one range guaranteed to have TickArrays already
// cloned by scripts/local-validator.sh, so Trade is usable the moment the
// app loads without hitting the tick-array-creation path.
const DEFAULT_TICK_LOWER = -40176;
const DEFAULT_TICK_UPPER = -38168;

export const useTradeFormStore = create<TradeFormState>((set) => ({
  side: "short",
  tickLower: DEFAULT_TICK_LOWER,
  tickUpper: DEFAULT_TICK_UPPER,
  sizeInput: "",
  rangeSource: "default",
  setSide: (side) => set({ side }),
  setRange: (tickLower, tickUpper, rangeSource = "manual") =>
    set({ tickLower, tickUpper, rangeSource }),
  setSizeInput: (sizeInput) => set({ sizeInput }),
}));
