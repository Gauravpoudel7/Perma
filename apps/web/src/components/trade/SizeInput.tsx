"use client";

import { NumberInput } from "../primitives/NumberInput";
import { InventoryEmptyState } from "./InventoryEmptyState";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useChainStore } from "../../store/useChainStore";
import { useRangeStateValue } from "../../hooks/useRangeState";
import { useRequiredFreeUsdc } from "../../hooks/useRequiredFreeUsdc";
import { useTicketSize } from "../../hooks/useTicketSize";
import { cleanAmountInput, TOKEN_DECIMALS } from "../../lib/ticketSize";
import { positionAmounts, type TokenSide } from "../../lib/liquidityMath";
import { formatBaseUnits, formatPair } from "../../lib/format";
import { maxAffordableLiquidity } from "../../lib/solvency";
import { sqrtPriceX64ToPrice } from "../../lib/whirlpool";

const UNIT: Record<TokenSide, string> = { sol: "SOL", usdc: "USDC" };
const SHOWN_DIGITS: Record<TokenSide, number> = { sol: 4, usdc: 2 };

/**
 * Position size in the token(s) the range actually holds at spot: SOL above
 * spot, USDC below, both around it (typing either fills the other). The
 * ticket turns the amount into Orca liquidity `L` (`lib/ticketSize.ts`); the
 * raw `L` stays visible under "Advanced". On LONG, a range with no short
 * liquidity left swaps in `InventoryEmptyState`, per the plan's honesty override.
 */
export function SizeInput() {
  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const amountInput = useTradeFormStore((s) => s.amountInput);
  const amountToken = useTradeFormStore((s) => s.amountToken);
  const setAmount = useTradeFormStore((s) => s.setAmount);
  const spot = useChainStore((s) => s.spot);
  const rangeState = useRangeStateValue(tickLower, tickUpper);
  const requiredView = useRequiredFreeUsdc();
  const size = useTicketSize();

  const available = rangeState
    ? BigInt(rangeState.totalShortLiquidity.toString()) - BigInt(rangeState.totalLongLiquidity.toString())
    : 0n;

  if (side === "long" && available <= 0n) {
    return (
      <div>
        <p className="text-body-sm mb-2 block text-text-muted">Position Size</p>
        <InventoryEmptyState />
      </div>
    );
  }
  if (!size || !spot) {
    return (
      <div>
        <p className="text-body-sm mb-2 block text-text-muted">Position Size</p>
        <p className="text-body-sm text-text-muted">Loading the pool price.</p>
      </div>
    );
  }

  const tokens: TokenSide[] = size.composition === "both" ? ["sol", "usdc"] : [size.composition];
  const shown = (t: TokenSide) => {
    if (t === size.token) return t === amountToken ? amountInput : "";
    // The linked field on a mixed range: what the typed amount implies.
    if (!size.liquidity) return "";
    return formatBaseUnits(t === "sol" ? size.amountA : size.amountB, TOKEN_DECIMALS[t], SHOWN_DIGITS[t]);
  };
  const where =
    size.composition === "sol"
      ? "This range is above spot, so it holds only SOL."
      : size.composition === "usdc"
      ? "This range is below spot, so it holds only USDC."
      : "This range holds SOL and USDC. Type either amount.";

  const spotPrice = sqrtPriceX64ToPrice(spot.sqrtPriceX64, 9, 6);
  const usd = (Number(size.amountA) / 1e9) * spotPrice + Number(size.amountB) / 1e6;

  // LONG "Max": the smaller of the short liquidity left here and what free USDC can margin.
  let max: { liquidity: bigint; limit: string } | null = null;
  if (side === "long") {
    const affordable = requiredView
      ? maxAffordableLiquidity(requiredView.marketRiskFields, requiredView.freeUsdc, requiredView.required)
      : null;
    max =
      affordable !== null && affordable < available
        ? { liquidity: affordable, limit: "your free USDC" }
        : { liquidity: available, limit: "short liquidity in this range" };
  }
  const maxAmounts = max ? positionAmounts(max.liquidity, spot.tickCurrentIndex, tickLower, tickUpper) : null;
  const maxInToken = maxAmounts ? (size.token === "sol" ? maxAmounts.amountA : maxAmounts.amountB) : 0n;

  return (
    <div role="group" aria-labelledby="position-size-label">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p id="position-size-label" className="text-body-sm text-text-muted">
          Position Size
        </p>
        {max && maxInToken > 0n && (
          <button
            type="button"
            onClick={() => setAmount(formatBaseUnits(maxInToken, TOKEN_DECIMALS[size.token]), size.token)}
            className="transition-brand focus-ring text-mono-sm rounded-sm border border-border px-2 py-1 text-text-muted hover:border-text-primary hover:text-text-primary"
          >
            Max
          </button>
        )}
      </div>
      <div className={tokens.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
        {tokens.map((t) => (
          <div key={t}>
            <label htmlFor={`position-size-${t}`} className="text-caption mb-1 block text-text-muted">
              {UNIT[t]}
            </label>
            <NumberInput
              id={`position-size-${t}`}
              placeholder={`0.00 ${UNIT[t]}`}
              value={shown(t)}
              aria-describedby="position-size-note"
              onChange={(e) => setAmount(cleanAmountInput(e.target.value, t), t)}
            />
          </div>
        ))}
      </div>
      <div id="position-size-note" className="text-body-sm mt-2 flex flex-col gap-1 text-text-muted">
        <p>{where}</p>
        {size.liquidity && side === "short" && (
          <p>
            Uses ≈{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">{formatPair(size.amountA, size.amountB)}</span>{" "}
            (~${usd.toFixed(2)}) from your vault balance.
          </p>
        )}
        {size.liquidity && side === "long" && (
          <p>
            Tracks ≈{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">{formatPair(size.amountA, size.amountB)}</span>{" "}
            of short liquidity at spot.
          </p>
        )}
        {max && maxAmounts && (
          <p>
            Max you can open ≈{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">
              {formatPair(maxAmounts.amountA, maxAmounts.amountB)}
            </span>
            , limited by {max.limit}.
          </p>
        )}
      </div>
      <details className="mt-2">
        <summary className="focus-ring text-caption cursor-pointer rounded-sm text-text-muted">Advanced</summary>
        <p className="text-mono-sm tabular-nums mt-1 text-text-muted">
          Liquidity sent on-chain: {size.liquidity?.toString() ?? "—"}
          {side === "long" && ` · available ${available.toString()}`}
        </p>
      </details>
    </div>
  );
}
