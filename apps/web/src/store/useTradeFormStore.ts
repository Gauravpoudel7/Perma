import { create } from "zustand";
import type { TokenSide } from "../lib/liquidityMath";

/** Ephemeral Trade-screen form state — never persisted, never chain-derived. */
export type Side = "short" | "long";

/** Where the current ticks came from, so the ticket can say so. */
export type RangeSource = "default" | "manual" | "preset" | "inventory";

interface TradeFormState {
  side: Side;
  tickLower: number;
  tickUpper: number;
  /** The size as typed, in `amountToken`. `lib/ticketSize.ts` turns it into liquidity. */
  amountInput: string;
  amountToken: TokenSide;
  rangeSource: RangeSource;
  setSide: (s: Side) => void;
  setRange: (tickLower: number, tickUpper: number, source?: RangeSource) => void;
  setAmount: (input: string, token: TokenSide) => void;
}

// Demo range default — the one range guaranteed to have TickArrays already
// cloned by scripts/local-validator.sh, so Trade is usable the moment the
// app loads without hitting the tick-array-creation path. On a cluster whose
// spot is far from it (Solana-devnet), `RangeInput` re-centres on spot once.
const DEFAULT_TICK_LOWER = -40176;
const DEFAULT_TICK_UPPER = -38168;

export const useTradeFormStore = create<TradeFormState>((set) => ({
  side: "short",
  tickLower: DEFAULT_TICK_LOWER,
  tickUpper: DEFAULT_TICK_UPPER,
  amountInput: "",
  amountToken: "sol",
  rangeSource: "default",
  setSide: (side) => set({ side }),
  setRange: (tickLower, tickUpper, rangeSource = "manual") =>
    set({ tickLower, tickUpper, rangeSource }),
  setAmount: (amountInput, amountToken) => set({ amountInput, amountToken }),
}));
