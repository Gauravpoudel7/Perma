/**
 * Schema and helpers for the indexer's SQLite cache (`node:sqlite`, stdlib).
 *
 * Two layers:
 *
 * - `raw_events` is the log. It is append-only and keyed `(signature, log_index)`,
 *   so re-ingesting a transaction is a no-op instead of a double count. This is
 *   what makes watermark rewind safe.
 * - Everything else is a *projection*: derived, disposable, and rebuilt from
 *   `raw_events` in one pass whenever new rows land (`projections.ts`). Nothing
 *   is incremented in place, so a replay cannot drift.
 *
 * Amounts wider than a JS number (`u64`, `u128`) are stored as decimal TEXT and
 * arithmetic on them uses `BigInt`. Slots and tick indices are plain integers.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS raw_events (
  signature  TEXT    NOT NULL,
  log_index  INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  slot       INTEGER NOT NULL,
  block_time INTEGER,
  payload    TEXT    NOT NULL,
  PRIMARY KEY (signature, log_index)
);
CREATE INDEX IF NOT EXISTS raw_events_order ON raw_events (slot, signature, log_index);

CREATE TABLE IF NOT EXISTS positions (
  perma_position   TEXT PRIMARY KEY,
  market           TEXT NOT NULL,
  owner            TEXT NOT NULL,
  leg_type         INTEGER NOT NULL,
  tick_lower       INTEGER NOT NULL,
  tick_upper       INTEGER NOT NULL,
  size             TEXT NOT NULL DEFAULT '0',
  entry_index      TEXT,
  status           INTEGER NOT NULL DEFAULT 0,
  premium_paid     TEXT NOT NULL DEFAULT '0',
  premium_claimed  TEXT NOT NULL DEFAULT '0',
  still_owed       TEXT NOT NULL DEFAULT '0',
  open_slot        INTEGER,
  open_signature   TEXT,
  close_slot       INTEGER,
  close_signature  TEXT,
  last_settle_slot INTEGER
);
CREATE INDEX IF NOT EXISTS positions_owner ON positions (owner, status);

CREATE TABLE IF NOT EXISTS collateral (
  market        TEXT NOT NULL,
  owner         TEXT NOT NULL,
  balance_a     TEXT NOT NULL DEFAULT '0',
  balance_b     TEXT NOT NULL DEFAULT '0',
  locked_a      TEXT NOT NULL DEFAULT '0',
  locked_b      TEXT NOT NULL DEFAULT '0',
  premium_paid  TEXT NOT NULL DEFAULT '0',
  premium_earned TEXT NOT NULL DEFAULT '0',
  still_owed    TEXT NOT NULL DEFAULT '0',
  last_slot     INTEGER,
  PRIMARY KEY (market, owner)
);

CREATE TABLE IF NOT EXISTS range_buckets (
  market          TEXT NOT NULL,
  tick_lower      INTEGER NOT NULL,
  tick_upper      INTEGER NOT NULL,
  short_liquidity TEXT NOT NULL DEFAULT '0',
  long_liquidity  TEXT NOT NULL DEFAULT '0',
  last_slot       INTEGER,
  PRIMARY KEY (market, tick_lower, tick_upper)
);

CREATE TABLE IF NOT EXISTS premium_points (
  market     TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  source     TEXT NOT NULL,
  block_time INTEGER,
  index_value TEXT NOT NULL,
  PRIMARY KEY (market, slot, source)
);

CREATE TABLE IF NOT EXISTS settlements (
  signature      TEXT NOT NULL,
  log_index      INTEGER NOT NULL,
  market         TEXT NOT NULL,
  owner          TEXT NOT NULL,
  perma_position TEXT NOT NULL,
  leg_type       INTEGER NOT NULL,
  amount         TEXT NOT NULL,
  still_owed     TEXT NOT NULL,
  slot           INTEGER NOT NULL,
  block_time     INTEGER,
  PRIMARY KEY (signature, log_index)
);
CREATE INDEX IF NOT EXISTS settlements_owner ON settlements (owner, slot);

-- Cash facts only: deposits, withdrawals, locks, unlocks. No mark PnL, ever.
CREATE TABLE IF NOT EXISTS collateral_events (
  signature  TEXT NOT NULL,
  log_index  INTEGER NOT NULL,
  market     TEXT NOT NULL,
  owner      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  amount_a   TEXT NOT NULL,
  amount_b   TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  block_time INTEGER,
  PRIMARY KEY (signature, log_index)
);
CREATE INDEX IF NOT EXISTS collateral_events_owner ON collateral_events (owner, slot);

-- Current on-chain truth, refreshed from the Market PDA by the ingest loop.
-- Written from an account read rather than from events so /markets cannot drift.
CREATE TABLE IF NOT EXISTS market_state (
  market     TEXT PRIMARY KEY,
  whirlpool  TEXT NOT NULL,
  snapshot   TEXT NOT NULL,
  slot       INTEGER,
  updated_at INTEGER
);

-- Schema exists so the shape is stable; P2 never writes a row. See P4.
CREATE TABLE IF NOT EXISTS liquidations (
  signature      TEXT NOT NULL,
  log_index      INTEGER NOT NULL,
  market         TEXT NOT NULL,
  owner          TEXT NOT NULL,
  perma_position TEXT NOT NULL,
  kind           TEXT NOT NULL,
  slot           INTEGER NOT NULL,
  block_time     INTEGER,
  PRIMARY KEY (signature, log_index)
);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMeta(db: Db, key: string, value: string | null): void {
  if (value === null) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value
  );
}

export interface Watermark {
  /** Highest finalized slot whose events are durably stored. */
  slot: number;
  /** Newest signature already ingested; the `until` bound for the next sweep. */
  signature: string | null;
  lastError: string | null;
  lastIngestAt: number | null;
}

export function getWatermark(db: Db): Watermark {
  return {
    slot: Number(getMeta(db, "watermark_slot") ?? 0),
    signature: getMeta(db, "watermark_signature"),
    lastError: getMeta(db, "last_error"),
    lastIngestAt: getMeta(db, "last_ingest_at") ? Number(getMeta(db, "last_ingest_at")) : null,
  };
}

/**
 * Rewind the sweep bound without touching `raw_events`. Used by ops and by the
 * gap-recovery test: the next sweep re-walks history and every row it re-sees
 * collides on `(signature, log_index)` instead of double counting.
 */
export function rewindWatermark(db: Db, toSlot = 0): void {
  setMeta(db, "watermark_slot", String(toSlot));
  setMeta(db, "watermark_signature", null);
}
