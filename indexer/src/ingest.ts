/**
 * Standing ingest: finalized program transactions → `raw_events` → projections.
 *
 * Invariants (`docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`):
 *
 * - **Finalized only.** Durable rows never come from a `confirmed` read. The web
 *   app may still decode its own `confirmed` transaction for a fast refetch —
 *   that is `apps/web/src/lib/events.ts` and it is untouched by this service.
 * - **Read-only.** No signing, no key material, no writes to the chain.
 * - **Gap recovery.** The watermark is only a sweep bound. Rewinding it re-walks
 *   history; every re-seen event collides on `(signature, log_index)` and every
 *   projection is re-folded from the log, so a replay is a no-op.
 *
 * Decoding reuses the same `EventParser` path as `scripts/reconcile.mjs` and
 * `apps/web/src/lib/events.ts`.
 */

import type { Connection, ConfirmedSignatureInfo } from "@solana/web3.js";
import {
  PROGRAM_ID,
  config,
  connection,
  eventParser,
  marketPda,
  premiumIndexPda,
  readMarket,
  readPremiumIndex,
  toJsonSafe,
} from "./chain.ts";
import { getWatermark, openDb, setMeta, type Db } from "./db.ts";
import { rebuild } from "./projections.ts";

const PAGE = 1000;
/** Safety stop for a first sweep against a long-lived ledger. */
const MAX_PAGES = 50;

export interface IngestResult {
  swept: number;
  inserted: number;
  slot: number;
}

/** Newest-first pages walked backwards, stopping at the watermark signature. */
async function signaturesSince(conn: Connection, until: string | null): Promise<ConfirmedSignatureInfo[]> {
  const out: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await conn.getSignaturesForAddress(
      PROGRAM_ID,
      { before, until: until ?? undefined, limit: PAGE },
      "finalized"
    );
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < PAGE) break;
    before = batch[batch.length - 1].signature;
  }
  return out.reverse(); // chronological
}

function insertTxEvents(db: Db, signature: string, slot: number, blockTime: number | null, logs: string[]): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO raw_events (signature, log_index, name, slot, block_time, payload)
     VALUES (?,?,?,?,?,?)`
  );
  let inserted = 0;
  let logIndex = 0;
  for (const ev of eventParser.parseLogs(logs, false)) {
    const payload = JSON.stringify(toJsonSafe(ev.data));
    // The camelCased IDL reports `shortMinted`; store the catalog's own spelling
    // (`ShortMinted`, per EVENT-CATALOG.md) so the log reads like the docs.
    const name = ev.name.charAt(0).toUpperCase() + ev.name.slice(1);
    const res = ins.run(signature, logIndex, name, slot, blockTime, payload);
    inserted += Number(res.changes);
    logIndex++;
  }
  return inserted;
}

/**
 * Snapshot current market config and pause state from the Market PDA.
 *
 * Deliberately an account read rather than a fold over `MarketPauseSet` /
 * `MarketRiskParamsSet`: `GET /markets` promises to match the on-chain PDA, and
 * only reading the PDA can promise that.
 */
async function refreshMarketState(db: Db, conn: Connection): Promise<void> {
  const pda = marketPda();
  const market = await readMarket(conn, pda);
  if (!market) return;
  db.prepare(
    `INSERT INTO market_state (market, whirlpool, snapshot, slot, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(market) DO UPDATE SET whirlpool = excluded.whirlpool, snapshot = excluded.snapshot,
       slot = excluded.slot, updated_at = excluded.updated_at`
  ).run(
    pda.toBase58(),
    String((toJsonSafe(market) as any).whirlpool),
    JSON.stringify(toJsonSafe(market)),
    await conn.getSlot("finalized"),
    Date.now()
  );
}

/**
 * Append a real premium-index point from the live `GlobalPremiumIndex` account.
 *
 * The point is stamped with the account's own `last_update_slot`, so it records
 * when the index actually moved rather than when this loop happened to look.
 * Repeated polls of an unchanged index collide on the primary key — no
 * duplicate points, and never an interpolated one.
 */
async function pollPremiumPoint(db: Db, conn: Connection): Promise<void> {
  const market = marketPda();
  const idx = await readPremiumIndex(conn, premiumIndexPda(market));
  if (!idx) return;
  const data = toJsonSafe(idx) as { currentIndex: string; lastUpdateSlot: string };
  const slot = Number(data.lastUpdateSlot);
  if (!Number.isFinite(slot) || slot <= 0) return;
  let blockTime: number | null = null;
  try {
    blockTime = await conn.getBlockTime(slot);
  } catch {
    // Slot may be outside the RPC's block history. A point without a timestamp
    // is still a real point; the chart falls back to slot on the x axis.
  }
  db.prepare(
    `INSERT OR IGNORE INTO premium_points (market, slot, source, block_time, index_value) VALUES (?,?,?,?,?)`
  ).run(market.toBase58(), slot, "poll", blockTime, String(data.currentIndex));
}

export async function ingestOnce(db: Db, conn: Connection = connection()): Promise<IngestResult> {
  const wm = getWatermark(db);
  /**
   * Read the head *before* asking for signatures, so "swept through" never
   * claims more than was actually examined. This is the slot `/health` measures
   * lag against; the watermark slot is the last slot PERMA itself touched, and
   * on an idle chain those two drift apart by design.
   */
  const sweptThrough = await conn.getSlot("finalized");
  let inserted = 0;
  let newestSlot = wm.slot;
  let newestSignature = wm.signature;

  const sigs = await signaturesSince(conn, wm.signature);
  for (const s of sigs) {
    // A failed transaction reverted its state; its logs must not become history.
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs || logs.length === 0) continue;
    // Slot and blockTime live on the transaction, never on the event payload.
    inserted += insertTxEvents(db, s.signature, tx.slot, tx.blockTime ?? null, logs);
    if (tx.slot >= newestSlot) {
      newestSlot = tx.slot;
      newestSignature = s.signature;
    }
  }

  if (inserted > 0) rebuild(db);
  await refreshMarketState(db, conn);
  await pollPremiumPoint(db, conn);

  setMeta(db, "watermark_slot", String(newestSlot));
  if (newestSignature) setMeta(db, "watermark_signature", newestSignature);
  setMeta(db, "swept_through_slot", String(sweptThrough));
  setMeta(db, "last_ingest_at", String(Date.now()));
  setMeta(db, "last_error", null);

  return { swept: sigs.length, inserted, slot: newestSlot };
}

/** Ingest forever. Errors are recorded on the watermark and surfaced by /health. */
export async function runIngestLoop(db: Db, signal?: AbortSignal): Promise<void> {
  const conn = connection();
  while (!signal?.aborted) {
    try {
      await ingestOnce(db, conn);
    } catch (err) {
      setMeta(db, "last_error", err instanceof Error ? err.message : String(err));
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

// `node src/ingest.ts` — one sweep, then exit. Useful in scripts and CI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb(config.dbPath);
  const result = await ingestOnce(db);
  console.log(JSON.stringify(result));
  db.close();
}
