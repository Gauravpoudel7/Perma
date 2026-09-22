"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../primitives/Table";
import { DegradedState, EmptyState, Skeleton } from "../primitives/States";
import { useIndexerQuery } from "../../hooks/useIndexer";
import { fetchHistory, type PortfolioHistory } from "../../lib/indexerApi";
import { explorerTxUrl } from "../../lib/explorer";
import { formatBaseUnits, truncateAddress } from "../../lib/format";
import { LEG_LONG } from "../../lib/constants";

const USDC_DECIMALS = 6;

interface Entry {
  signature: string;
  slot: number;
  blockTime: number | null;
  what: string;
  detail: string;
}

/**
 * Cash facts only: what moved, when, and the transaction that moved it. No
 * unrealized mark PnL and no percentage — premium is paid and claimed in cash,
 * and ADR-0003 has no mark-to-market concept to report against.
 */
function toEntries(h: PortfolioHistory): Entry[] {
  const entries: Entry[] = [];

  for (const p of h.closedPositions) {
    const isLong = p.legType === LEG_LONG;
    entries.push({
      signature: p.closeSignature as string,
      slot: p.closeSlot ?? 0,
      blockTime: null,
      what: isLong ? "Closed long" : "Closed short",
      detail: isLong
        ? `[${p.tickLower}, ${p.tickUpper}] · premium paid ${formatBaseUnits(BigInt(p.premiumPaid), USDC_DECIMALS)} USDC`
        : `[${p.tickLower}, ${p.tickUpper}] · premium claimed ${formatBaseUnits(BigInt(p.premiumClaimed), USDC_DECIMALS)} USDC`,
    });
  }

  for (const s of h.settlements) {
    entries.push({
      signature: s.signature,
      slot: s.slot,
      blockTime: s.blockTime,
      what: s.legType === LEG_LONG ? "Premium paid" : "Premium claimed",
      detail: `${formatBaseUnits(BigInt(s.amount), USDC_DECIMALS)} USDC`,
    });
  }

  const CASH_LABEL = { deposit: "Deposit", withdraw: "Withdraw", lock: "Collateral locked", unlock: "Collateral unlocked" };
  for (const c of h.collateral) {
    entries.push({
      signature: c.signature,
      slot: c.slot,
      blockTime: c.blockTime,
      what: CASH_LABEL[c.kind],
      detail: `${formatBaseUnits(BigInt(c.amountB), USDC_DECIMALS)} USDC`,
    });
  }

  return entries.sort((a, b) => b.slot - a.slot);
}

/** Only when the indexer recorded a block time. Never estimated from the slot. */
function formatWhen(blockTime: number | null): string {
  if (blockTime === null) return "—";
  return new Date(blockTime * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/**
 * Indexed history. The indexer is a cache, so this section is additive: when it
 * is absent or unreachable the rest of Portfolio works exactly as it did before,
 * off live RPC polls.
 */
export function HistoryTable() {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? "";
  const { data, loading, degraded, configured } = useIndexerQuery(
    () => (owner ? fetchHistory(owner) : Promise.resolve(null)),
    [owner]
  );

  if (!configured) {
    return <EmptyState>History needs the indexer. Set NEXT_PUBLIC_INDEXER_URL to enable it.</EmptyState>;
  }
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading history">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (degraded || !data) {
    return (
      <DegradedState>
        The indexer is not responding, so past activity cannot be shown. Your open positions
        above still come straight from the chain.
      </DegradedState>
    );
  }

  const entries = toEntries(data);
  if (entries.length === 0) {
    return <EmptyState>No past activity indexed for this wallet.</EmptyState>;
  }

  return (
    <>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Event</TableHeaderCell>
            <TableHeaderCell>Detail</TableHeaderCell>
            <TableHeaderCell>When</TableHeaderCell>
            <TableHeaderCell>Slot</TableHeaderCell>
            <TableHeaderCell>Transaction</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={`${e.signature}:${e.what}:${e.slot}`}>
              <TableCell>{e.what}</TableCell>
              <TableCell className="text-mono-md tabular-nums">{e.detail}</TableCell>
              <TableCell className="text-mono-sm tabular-nums whitespace-nowrap text-text-muted">{formatWhen(e.blockTime)}</TableCell>
              <TableCell className="text-mono-md tabular-nums">{e.slot}</TableCell>
              <TableCell>
                <a
                  href={explorerTxUrl(e.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-brand focus-ring text-mono-md rounded-md underline"
                >
                  {truncateAddress(e.signature, 6)}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-body-sm mt-2 text-text-muted">
        Indexed through slot{" "}
        <span className="text-mono-sm tabular-nums">{data.watermark.slot}</span>. Anything newer
        than that is not here yet.
      </p>
    </>
  );
}
