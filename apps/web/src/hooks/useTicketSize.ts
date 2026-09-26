"use client";

import { useChainStore } from "../store/useChainStore";
import { useTradeFormStore } from "../store/useTradeFormStore";
import { ticketSize, type TicketSize } from "../lib/ticketSize";

/** The ticket's size at the live spot tick. Null until spot has loaded. */
export function useTicketSize(): TicketSize | null {
  const spot = useChainStore((s) => s.spot);
  const input = useTradeFormStore((s) => s.amountInput);
  const inputToken = useTradeFormStore((s) => s.amountToken);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  if (!spot) return null;
  return ticketSize({ input, inputToken, tickCurrent: spot.tickCurrentIndex, tickLower, tickUpper });
}
