"use client";

import { TableRow, TableCell } from "../primitives/Table";
import { Badge } from "../primitives/Badge";
import { CloseSettleAction } from "./CloseSettleAction";
import { useChainStore } from "../../store/useChainStore";
import { useRangeState } from "../../hooks/useRangeState";
import {
  payableIfSettledNow,
  projectedIndex,
  shortAccruedPremium,
} from "../../lib/solvency";
import { formatBaseUnits } from "../../lib/format";
import { tickToPrice } from "../../lib/whirlpool";
import { LEG_LONG, LEG_SHORT, STATUS_OPEN, STATUS_PENDING_PREMIUM } from "../../lib/constants";
import type { PositionWithPubkey } from "../../lib/accounts";

// Demo pool: WSOL (9 decimals) / devUSDC (6 decimals).
const DECIMALS_A = 9;
const DECIMALS_B = 6;

export function PositionRow({ position }: { position: PositionWithPubkey }) {
  const market = useChainStore((s) => s.market);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const rangeState = useRangeState(position.tickLower, position.tickUpper);

  if (!market) return null;

  const isLong = position.legType === LEG_LONG;

  let accrued = 0n;
  if (isLong && premiumIndex) {
    const projected = projectedIndex(
      { currentIndex: BigInt(premiumIndex.currentIndex.toString()), lastUpdateSlot: BigInt(premiumIndex.lastUpdateSlot.toString()) },
      BigInt(market.premiumRate.toString()),
      // Using lastUpdateSlot as a lower-bound "now" is deliberately conservative
      // display-only; the on-chain gate always uses the real current slot.
      BigInt(premiumIndex.lastUpdateSlot.toString())
    );
    accrued = payableIfSettledNow(
      {
        accruedScaled: BigInt(position.accruedScaled.toString()),
        entryIndex: BigInt(position.entryIndex.toString()),
        liquidity: BigInt(position.liquidity.toString()),
      },
      projected,
      BigInt(market.premiumMultiplier.toString())
    );
  } else if (!isLong && rangeState) {
    accrued = shortAccruedPremium(
      {
        entryAccQ64: BigInt(position.entryAccQ64.toString()),
        liquidity: BigInt(position.liquidity.toString()),
        premiumReceivable: BigInt(position.premiumReceivable.toString()),
      },
      { accPremiumPerShortQ64: BigInt(rangeState.accPremiumPerShortQ64.toString()) }
    );
  }

  const lowPrice = tickToPrice(position.tickLower, DECIMALS_A, DECIMALS_B);
  const highPrice = tickToPrice(position.tickUpper, DECIMALS_A, DECIMALS_B);

  return (
    <TableRow>
      <TableCell>{isLong ? "Long" : "Short"}</TableCell>
      <TableCell className="text-mono-md tabular-nums">
        {lowPrice.toFixed(2)}–{highPrice.toFixed(2)} USDC/SOL
      </TableCell>
      <TableCell className="text-mono-md tabular-nums">
        {position.liquidity.toString()}
      </TableCell>
      <TableCell className="text-mono-md tabular-nums">
        Est. {formatBaseUnits(accrued, DECIMALS_B, 6)} USDC
      </TableCell>
      <TableCell>
        <Badge tone={position.status === STATUS_PENDING_PREMIUM ? "warning" : "neutral"}>
          {position.status === STATUS_PENDING_PREMIUM ? "Pending Premium" : "Open"}
        </Badge>
      </TableCell>
      <TableCell>
        <CloseSettleAction position={position} hasAccrued={accrued > 0n} />
      </TableCell>
    </TableRow>
  );
}
