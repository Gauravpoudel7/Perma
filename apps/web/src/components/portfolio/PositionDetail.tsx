"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SlideOver, SlideOverRow as Row } from "../primitives/SlideOver";
import { Badge } from "../primitives/Badge";
import { CloseSettleAction } from "./CloseSettleAction";
import { usePositionSummary } from "../../hooks/usePositionSummary";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { formatBaseUnits, truncateAddress } from "../../lib/format";
import { SETTLE_DUST_USDC_MICRO } from "../../lib/solvency";
import { PENDING_PREMIUM_SHEET_SUBTITLE } from "../../lib/positionActions";
import { explorerAddressUrl } from "../../lib/explorer";
import type { PositionWithPubkey } from "../../lib/accounts";

const DECIMALS_B = 6;

/**
 * The slide-over a row opens. Same facts as the row, plus the position
 * account itself and a way back to the ticket. Close / Settle are the same
 * `CloseSettleAction` as the row. There is no P&L, mark, or health figure
 * here because none exists on-chain for Fair (ADR-0003).
 */
export function PositionDetail({ position, onClose }: { position: PositionWithPubkey | null; onClose: () => void }) {
  return position ? <Body position={position} onClose={onClose} /> : null;
}

function Body({ position, onClose }: { position: PositionWithPubkey; onClose: () => void }) {
  const s = usePositionSummary(position);
  const setSide = useTradeFormStore((st) => st.setSide);
  const setRange = useTradeFormStore((st) => st.setRange);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const address = position.pubkey.toBase58();

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  if (!s) return null;

  return (
    <SlideOver
      open
      title="Position"
      subtitle={
        s.pending
          ? PENDING_PREMIUM_SHEET_SUBTITLE
          : "Premium accrues continuously and settles when you close."
      }
      onClose={onClose}
      initialFocusRef={copyRef}
      footer={<CloseSettleAction position={position} actions={s.actions} shortPayable={s.shortPayable} />}
    >
      <dl className="flex flex-col gap-4">
        <Row label="Side" value={s.sideLabel} mono={false} />
        <Row
          label="Realized range"
          value={`${s.lowPrice.toFixed(2)}–${s.highPrice.toFixed(2)} USDC/SOL`}
          hint={`ticks ${position.tickLower} to ${position.tickUpper}`}
        />
        <Row label="Position size" value={`${s.liquidity.toString()} liquidity units`} />
        <Row label="Status" value={<Badge tone={s.pending ? "warning" : "neutral"}>{s.statusLabel}</Badge>} mono={false} />
        <Row
          label="Accrued premium"
          value={`Est. ${formatBaseUnits(s.accrued, DECIMALS_B, 6)} USDC`}
          // The number is always the real one; only the Settle action has a floor.
          hint={
            s.isLong && s.accrued > 0n && s.accrued < SETTLE_DUST_USDC_MICRO
              ? "Below the settle threshold; closing settles it."
              : undefined
          }
        />
        <Row
          label="Position account"
          value={
            <span className="flex flex-wrap items-center gap-3">
              <span>{truncateAddress(address, 6)}</span>
              <button
                ref={copyRef}
                type="button"
                className="transition-brand focus-ring text-caption rounded-sm border border-border px-2 py-1 text-text-muted hover:border-text-primary hover:text-text-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(address).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                className="transition-brand focus-ring text-caption rounded-sm text-text-muted underline underline-offset-2 hover:text-text-primary"
              >
                View account
              </a>
            </span>
          }
        />
      </dl>
      <Link
        href="/trade"
        onClick={() => {
          setSide(s.isLong ? "long" : "short");
          setRange(position.tickLower, position.tickUpper);
        }}
        className="transition-brand focus-ring text-body-sm mt-auto rounded-md text-text-primary underline underline-offset-2"
      >
        Open a similar position on Trade
      </Link>
    </SlideOver>
  );
}
