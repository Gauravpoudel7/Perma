"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { RangeSlider } from "../primitives/RangeSlider";
import { TickArrayRentNotice } from "./TickArrayRentNotice";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useChainStore } from "../../store/useChainStore";
import { checkTickArraysExist, findSampleTickArrayLen, FALLBACK_TICK_ARRAY_LEN, type TickArrayStatus } from "../../lib/tickArray";
import { sqrtPriceX64ToPrice, tickToPrice } from "../../lib/whirlpool";
import { centeredRange, isFarFromSpot } from "../../lib/rangeCenter";
import { WHIRLPOOL } from "../../lib/constants";

const DECIMALS_A = 9;
const DECIMALS_B = 6;
const MIN_TICK = -443636;
const MAX_TICK = 443636;
// Half-widths, in tick spacings, for the "around spot" presets. Plain
// numbers, not "ATM"/"ITM": there is no strike and no moneyness in a range.
const PRESET_SPACINGS = [8, 32, 128] as const;
// The slider spans a window of ±512 spacings around spot (≈ ×2.3 / ÷2.3 in
// price), widened to include the current range. The full Whirlpool tick
// domain (±443636) made a 2000-tick range a single pixel wide.
const WINDOW_SPACINGS = 512;

function clampTick(t: number): number {
  return Math.min(MAX_TICK, Math.max(MIN_TICK, t));
}

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
  const rangeSource = useTradeFormStore((s) => s.rangeSource);
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

  // The untouched default is the localnet demo range. Where spot is far from
  // it (Solana-devnet), open the ticket around spot instead - once: any range
  // the user picks, including from inventory, is never moved for them.
  useEffect(() => {
    if (!spot || rangeSource !== "default") return;
    if (!isFarFromSpot(tickLower, tickUpper, spot.tickCurrentIndex)) return;
    const [lo, hi] = centeredRange(spot.tickCurrentIndex, tickSpacing);
    setRange(clampTick(lo), clampTick(hi), "preset");
  }, [spot, rangeSource, tickLower, tickUpper, tickSpacing, setRange]);

  const far = spot !== null && isFarFromSpot(tickLower, tickUpper, spot.tickCurrentIndex);
  function recenter() {
    if (!spot) return;
    const [lo, hi] = centeredRange(spot.tickCurrentIndex, tickSpacing);
    setRange(clampTick(lo), clampTick(hi), "preset");
  }

  const needsRent = status && (!status.lowerExists || !status.upperExists);

  const center = spot
    ? Math.floor(spot.tickCurrentIndex / tickSpacing) * tickSpacing
    : Math.floor((tickLower + tickUpper) / 2 / tickSpacing) * tickSpacing;
  const sliderMin = clampTick(Math.min(tickLower, center - WINDOW_SPACINGS * tickSpacing));
  const sliderMax = clampTick(Math.max(tickUpper, center + WINDOW_SPACINGS * tickSpacing));

  // Snap the current pool tick to the spacing, then open ±n spacings around it.
  function applyPreset(n: number) {
    if (!spot) return;
    const center = Math.floor(spot.tickCurrentIndex / tickSpacing) * tickSpacing;
    setRange(clampTick(center - n * tickSpacing), clampTick(center + n * tickSpacing), "preset");
  }

  return (
    <div role="group" aria-labelledby="price-range-label">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span id="price-range-label" className="text-body-sm block text-text-muted">
          Price Range
        </span>
        {spot && (
          <div className="flex items-center gap-1" role="group" aria-label="Around spot, in tick spacings">
            <span className="text-caption text-text-muted">Around spot</span>
            {PRESET_SPACINGS.map((n) => (
              <button
                key={n}
                type="button"
                className="transition-brand focus-ring text-mono-sm tabular-nums rounded-sm border border-border px-2 py-1 text-text-muted hover:border-text-primary hover:text-text-primary"
                onClick={() => applyPreset(n)}
              >
                ±{n}
              </button>
            ))}
          </div>
        )}
      </div>
      <RangeSlider
        min={sliderMin}
        max={sliderMax}
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
      {far && spot && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
          <p className="text-body-sm text-text-muted">
            Spot is{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">
              {sqrtPriceX64ToPrice(spot.sqrtPriceX64, DECIMALS_A, DECIMALS_B).toFixed(2)}
            </span>{" "}
            USDC/SOL, far outside this range.
          </p>
          <button
            type="button"
            onClick={recenter}
            className="transition-brand focus-ring text-body-sm rounded-sm border border-border px-3 py-2 text-text-primary hover:border-text-primary"
          >
            Re-center on spot
          </button>
        </div>
      )}
      {rangeSource === "inventory" && (
        <p className="text-body-sm mt-1 text-text-muted">Selected range from inventory.</p>
      )}
      {needsRent && (
        <div className="mt-3">
          <TickArrayRentNotice lamports={rentLamports} />
        </div>
      )}
    </div>
  );
}
