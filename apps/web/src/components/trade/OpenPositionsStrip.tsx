"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useChainStore } from "../../store/useChainStore";
import { tickToPrice } from "../../lib/whirlpool";
import { LEG_LONG, STATUS_CLOSED, STATUS_PENDING_PREMIUM } from "../../lib/constants";

const DECIMALS_A = 9;
const DECIMALS_B = 6;
const MAX_ROWS = 5;

/**
 * A read-only glance at what this wallet already has open, under the desk.
 * Side, range, size, status — nothing else. Premium math and Close/Settle
 * live in Portfolio (`PositionRow`); there is no P&L to show (ADR-0003).
 */
export function OpenPositionsStrip() {
  const { connected } = useWallet();
  const positions = useChainStore((s) => s.positions);
  const live = positions.filter((p) => p.status !== STATUS_CLOSED);

  if (!connected || live.length === 0) return null;

  return (
    <section aria-label="Open positions" className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-overline text-text-muted">
          Open positions <span className="tabular-nums">({live.length})</span>
        </h2>
        <Link href="/portfolio" className="transition-brand focus-ring text-body-sm rounded-md text-text-primary underline underline-offset-2">
          View in Portfolio
        </Link>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {live.slice(0, MAX_ROWS).map((p) => {
          const isLong = p.legType === LEG_LONG;
          const pending = p.status === STATUS_PENDING_PREMIUM;
          return (
            <li key={p.pubkey.toBase58()} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="text-body-sm w-12 text-text-primary">{isLong ? "Long" : "Short"}</span>
              <span className="text-mono-sm tabular-nums text-text-muted">
                {tickToPrice(p.tickLower, DECIMALS_A, DECIMALS_B).toFixed(2)}–
                {tickToPrice(p.tickUpper, DECIMALS_A, DECIMALS_B).toFixed(2)} USDC/SOL
              </span>
              <span className="text-mono-sm tabular-nums ml-auto text-text-muted">{p.liquidity.toString()}</span>
              <span className="text-caption text-text-muted">{pending ? "Pending Premium" : "Open"}</span>
            </li>
          );
        })}
      </ul>
      {live.length > MAX_ROWS && (
        <p className="text-body-sm mt-2 text-text-muted">
          Showing {MAX_ROWS} of <span className="tabular-nums">{live.length}</span>.
        </p>
      )}
    </section>
  );
}
