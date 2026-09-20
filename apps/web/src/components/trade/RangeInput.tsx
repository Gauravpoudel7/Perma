"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { RangeSlider } from "../primitives/RangeSlider";
import { TickArrayRentNotice } from "./TickArrayRentNotice";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useChainStore } from "../../store/useChainStore";
import { checkTickArraysExist, findSampleTickArrayLen, FALLBACK_TICK_ARRAY_LEN, type TickArrayStatus } from "../../lib/tickArray";
import { tickToPrice } from "../../lib/whirlpool";
import { WHIRLPOOL } from "../../lib/constants";

const DECIMALS_A = 9;
const DECIMALS_B = 6;
const MIN_TICK = -443636;
const MAX_TICK = 443636;

/**
 * COPY-DECK §4.1: "Price Range" label, tick-spacing snap helper text, and
 * the realized-range readout. Also owns the tick-array existence check —
 * `OpenPositionButton` reads `missingTickArrays` from this hook's return
 * value (via the shared store) to decide whether to prepend the real
 * `initialize_tick_array` CPI to the mint transaction.
 */
export function RangeInput({
  onTickArrayStatus,
}: {
  onTickArrayStatus: (status: TickArrayStatus | null, rentLamports: bigint) => void;
}) {
  const { connection } = useConnection();
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const setRange = useTradeFormStore((s) => s.setRange);
  const market = useChainStore((s) => s.market);
  const spot = useChainStore((s) => s.spot);
  const [status, setStatus] = useState<TickArrayStatus | null>(null);
  const [rentLamports, setRentLamports] = useState(0n);

  const tickSpacing = market?.tickSpacing ?? 8;

  useEffect(() => {
    let cancelled = false;
    if (!market) return;
    checkTickArraysExist(connection, WHIRLPOOL, tickLower, tickUpper, tickSpacing).then(
      async (s) => {
        if (cancelled) return;
        setStatus(s);
        if (!s.lowerExists || !s.upperExists) {
          const sampleLen =
            (await findSampleTickArrayLen(
              connection,
              WHIRLPOOL,
              spot?.tickCurrentIndex ?? tickLower,
              tickSpacing
            )) ?? FALLBACK_TICK_ARRAY_LEN;
          const rentPerArray = BigInt(await connection.getMinimumBalanceForRentExemption(sampleLen));
          const count = (s.lowerExists ? 0 : 1) + (s.sameArray ? 0 : s.upperExists ? 0 : 1);
          const rent = rentPerArray * BigInt(Math.max(count, s.sameArray ? 1 : 0));
          setRentLamports(rent);
          onTickArrayStatus(s, rent);
        } else {
          setRentLamports(0n);
          onTickArrayStatus(s, 0n);
        }
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, market, tickLower, tickUpper, tickSpacing]);

  const needsRent = status && (!status.lowerExists || !status.upperExists);

  return (
    <div>
      <label className="text-body-sm mb-2 block text-text-muted">Price Range</label>
      <RangeSlider
        min={MIN_TICK}
        max={MAX_TICK}
        step={tickSpacing}
        lower={tickLower}
        upper={tickUpper}
        onChange={setRange}
      />
      <p className="text-body-sm mt-2 text-text-muted">
        Snapped to the pool&rsquo;s tick spacing. Your realized range may be slightly wider than
        requested.
      </p>
      <p className="text-mono-sm tabular-nums mt-2 text-text-primary">
        Realized range: {tickToPrice(tickLower, DECIMALS_A, DECIMALS_B).toFixed(2)}–
        {tickToPrice(tickUpper, DECIMALS_A, DECIMALS_B).toFixed(2)} USDC/SOL (ticks {tickLower} to{" "}
        {tickUpper})
      </p>
      {needsRent && (
        <div className="mt-3">
          <TickArrayRentNotice lamports={rentLamports} />
        </div>
      )}
    </div>
  );
}
