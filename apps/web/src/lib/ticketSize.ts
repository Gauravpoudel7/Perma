/**
 * The ticket's size, in the token a trader understands, turned into the
 * liquidity `L` the program takes. One pure function so the size field, the
 * review sheet and the mint all read the same `L`.
 */
import { amountsForLiquidity, liquidityForAmount, rangeComposition, type TokenSide } from "./liquidityMath";
import { formatTokenAmount, parseToBaseUnits } from "./format";

export const TOKEN_DECIMALS: Record<TokenSide, number> = { sol: 9, usdc: 6 };

export interface TicketSize {
  /** What the range holds at the current tick. */
  composition: TokenSide | "both";
  /** The token the size field is in: the trader's pick on a mixed range, else the only one the range uses. */
  token: TokenSide;
  /** Null when nothing usable is typed. */
  liquidity: bigint | null;
  /** What `liquidity` uses at spot, rounded up (base units). An estimate: Orca decides the fill. */
  amountA: bigint;
  amountB: bigint;
  error: string | null;
}

/** Keep digits and one dot, and no more fraction digits than the token has. */
export function cleanAmountInput(raw: string, token: TokenSide): string {
  const [whole = "", ...rest] = raw.replace(/[^0-9.]/g, "").split(".");
  if (rest.length === 0) return whole;
  return `${whole}.${rest.join("").slice(0, TOKEN_DECIMALS[token])}`;
}

export function ticketSize(o: {
  input: string;
  inputToken: TokenSide;
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
}): TicketSize {
  const composition = rangeComposition(o.tickCurrent, o.tickLower, o.tickUpper);
  const token = composition === "both" ? o.inputToken : composition;
  const empty = { composition, token, liquidity: null, amountA: 0n, amountB: 0n, error: null };
  // A number typed as SOL is never re-read as USDC when the range moves across spot.
  if (token !== o.inputToken || !o.input) return empty;
  const amount = parseToBaseUnits(o.input, TOKEN_DECIMALS[token]);
  if (amount <= 0n) return empty;
  const liquidity = liquidityForAmount(token, amount, o.tickCurrent, o.tickLower, o.tickUpper);
  if (liquidity <= 0n) return { ...empty, error: "This amount is too small for this range." };
  const { amountA, amountB } = amountsForLiquidity(Number(liquidity), o.tickCurrent, o.tickLower, o.tickUpper);
  return {
    composition,
    token,
    liquidity,
    amountA: BigInt(Math.ceil(amountA)),
    amountB: BigInt(Math.ceil(amountB)),
    error: null,
  };
}

/** Why a short can't open: what the vault is missing, for the "Deposit on Vault" line. */
export function vaultShortfall(
  caps: { tokenMaxA: bigint; tokenMaxB: bigint },
  free: { a: bigint; b: bigint }
): string | null {
  const missing = [
    caps.tokenMaxA > free.a ? formatTokenAmount(caps.tokenMaxA - free.a, "sol") : null,
    caps.tokenMaxB > free.b ? formatTokenAmount(caps.tokenMaxB - free.b, "usdc") : null,
  ].filter(Boolean);
  return missing.length ? `Your vault needs ${missing.join(" and ")} more for this short.` : null;
}
