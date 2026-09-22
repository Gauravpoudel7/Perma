/**
 * The public read surface from `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md`.
 *
 * Public reads only. There is no write route, no privileged route, and no route
 * that could ever sign anything. Every response carries the `watermark` so a
 * client can decide for itself that this data is stale and fall back to RPC —
 * the UI treats this service as an untrusted cache, never as a balance oracle.
 */

import type { Db } from "./db.ts";
import { getMeta, getWatermark } from "./db.ts";
import { marketPda } from "./chain.ts";

export const API_PREFIX = "/v1";

export interface RouteDeps {
  /** Live finalized slot, for the health lag figure. `null` when RPC is unreachable. */
  finalizedSlot?: () => Promise<number | null>;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

const rows = (db: Db, sql: string, ...params: unknown[]): any[] =>
  db.prepare(sql).all(...(params as any[])) as unknown as any[];

/**
 * Rides on every response. `historyComplete` is false when the log provably does
 * not reach the beginning of a market's life — an RPC that pruned blocks, or a
 * database seeded mid-life. Every sum derived from the fold is then too small,
 * so the client must hide inventory instead of drawing a number that is wrong.
 */
function watermarkBlock(db: Db) {
  const wm = getWatermark(db);
  const unattributedBurns = Number(getMeta(db, "unattributed_burns") ?? 0);
  const genesis = new Set(JSON.parse(getMeta(db, "genesis_markets") ?? "[]") as string[]);
  const indexed = rows(db, "SELECT market FROM market_state").map((r) => r.market as string);
  const missingGenesis = indexed.filter((m) => !genesis.has(m));
  return {
    slot: wm.slot,
    signature: wm.signature,
    lastIngestAt: wm.lastIngestAt,
    lastError: wm.lastError,
    unattributedBurns,
    missingGenesis,
    historyComplete: unattributedBurns === 0 && missingGenesis.length === 0,
  };
}

const positionColumns = `perma_position AS permaPosition, market, owner, leg_type AS legType,
  tick_lower AS tickLower, tick_upper AS tickUpper, size, entry_index AS entryIndex, status,
  premium_paid AS premiumPaid, premium_claimed AS premiumClaimed, still_owed AS stillOwed,
  open_slot AS openSlot, open_signature AS openSignature, close_slot AS closeSlot,
  close_signature AS closeSignature, last_settle_slot AS lastSettleSlot`;

function marketRows(db: Db, id?: string) {
  const sql = `SELECT market, whirlpool, snapshot, slot, updated_at AS updatedAt FROM market_state${
    id ? " WHERE market = ?" : ""
  }`;
  return rows(db, sql, ...(id ? [id] : [])).map((r) => {
    const snapshot = JSON.parse(r.snapshot);
    const inv = db
      .prepare(
        `SELECT COUNT(*) AS ranges,
                COALESCE(SUM(CAST(short_liquidity AS REAL)), 0) AS shortApprox,
                COALESCE(SUM(CAST(long_liquidity AS REAL)), 0) AS longApprox
         FROM range_buckets WHERE market = ?`
      )
      .get(r.market) as any;
    return {
      market: r.market,
      whirlpool: r.whirlpool,
      isPaused: snapshot.isPaused ?? null,
      tickSpacing: snapshot.tickSpacing ?? null,
      premiumRate: snapshot.premiumRate ?? null,
      premiumMultiplier: snapshot.premiumMultiplier ?? null,
      longMarginHorizonSlots: snapshot.longMarginHorizonSlots ?? null,
      longMarginBufferUsdc: snapshot.longMarginBufferUsdc ?? null,
      snapshotSlot: r.slot,
      snapshotAt: r.updatedAt,
      // Exact per-range figures live on /markets/{id}; these are a summary only.
      inventory: { ranges: Number(inv.ranges), shortApprox: inv.shortApprox, longApprox: inv.longApprox },
    };
  });
}

export async function handle(db: Db, url: URL, deps: RouteDeps = {}): Promise<RouteResult> {
  const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
  const parts = path.split("/").filter(Boolean);
  const wm = watermarkBlock(db);

  // GET /health
  if (parts.length === 1 && parts[0] === "health") {
    const finalizedSlot = deps.finalizedSlot ? await deps.finalizedSlot() : null;
    const eventCount = (db.prepare("SELECT COUNT(*) AS n FROM raw_events").get() as any).n;
    /**
     * Lag is measured against the last slot the sweep examined, not against the
     * last slot PERMA emitted an event in. On a quiet chain those differ by
     * however long nobody traded, and reporting that as lag would call a fully
     * caught-up indexer stale.
     */
    const sweptThrough = Number(getMeta(db, "swept_through_slot") ?? 0);
    return {
      status: 200,
      body: {
        watermarkSlot: wm.slot,
        finalizedSlot,
        sweptThroughSlot: sweptThrough,
        lagSlots: finalizedSlot === null ? null : Math.max(0, finalizedSlot - sweptThrough),
        lastIngestAt: wm.lastIngestAt,
        lastError: wm.lastError,
        eventCount: Number(eventCount),
        unattributedBurns: wm.unattributedBurns,
        missingGenesis: wm.missingGenesis,
        historyComplete: wm.historyComplete,
      },
    };
  }

  // GET /markets
  if (parts.length === 1 && parts[0] === "markets") {
    return { status: 200, body: { watermark: wm, markets: marketRows(db) } };
  }

  // GET /markets/{id}
  if (parts.length === 2 && parts[0] === "markets") {
    const [market] = marketRows(db, parts[1]);
    if (!market) return { status: 404, body: { error: "unknown market", watermark: wm } };
    const buckets = rows(
      db,
      `SELECT tick_lower AS tickLower, tick_upper AS tickUpper, short_liquidity AS shortLiquidity,
              long_liquidity AS longLiquidity, last_slot AS lastSlot
       FROM range_buckets WHERE market = ? ORDER BY tick_lower`,
      parts[1]
    );
    const latest = db
      .prepare(
        `SELECT slot, source, block_time AS blockTime, index_value AS indexValue
         FROM premium_points WHERE market = ? ORDER BY slot DESC LIMIT 1`
      )
      .get(parts[1]) as any;
    // Inventory, not depth: these are indexed PERMA liquidity buckets, not an order book.
    return { status: 200, body: { watermark: wm, market, inventoryByRange: buckets, premiumIndex: latest ?? null } };
  }

  // GET /positions/{owner} and /positions/{owner}/history
  if (parts[0] === "positions" && (parts.length === 2 || (parts.length === 3 && parts[2] === "history"))) {
    const owner = parts[1];
    if (parts.length === 2) {
      return {
        status: 200,
        body: {
          watermark: wm,
          positions: rows(db, `SELECT ${positionColumns} FROM positions WHERE owner = ? AND status = 0 ORDER BY open_slot`, owner),
        },
      };
    }
    return {
      status: 200,
      body: {
        watermark: wm,
        closedPositions: rows(
          db,
          `SELECT ${positionColumns} FROM positions WHERE owner = ? AND status != 0 ORDER BY close_slot DESC`,
          owner
        ),
        settlements: rows(
          db,
          `SELECT signature, log_index AS logIndex, market, perma_position AS permaPosition, leg_type AS legType,
                  amount, still_owed AS stillOwed, slot, block_time AS blockTime
           FROM settlements WHERE owner = ? ORDER BY slot DESC, log_index DESC`,
          owner
        ),
        collateral: rows(
          db,
          `SELECT signature, log_index AS logIndex, market, kind, amount_a AS amountA, amount_b AS amountB,
                  slot, block_time AS blockTime
           FROM collateral_events WHERE owner = ? ORDER BY slot DESC, log_index DESC`,
          owner
        ),
        // P4 territory. The shape is stable so the UI never has to change for it.
        liquidations: [],
      },
    };
  }

  // GET /collateral/{owner}
  if (parts.length === 2 && parts[0] === "collateral") {
    return {
      status: 200,
      body: {
        watermark: wm,
        // Display only. The UI RPC-verifies free balance before any withdraw.
        accounts: rows(
          db,
          `SELECT market, balance_a AS balanceA, balance_b AS balanceB, locked_a AS lockedA, locked_b AS lockedB,
                  premium_paid AS premiumPaid, premium_earned AS premiumEarned, still_owed AS stillOwed,
                  last_slot AS lastSlot
           FROM collateral WHERE owner = ?`,
          parts[1]
        ),
      },
    };
  }

  // GET /premium/series?market=&limit=
  if (parts.length === 2 && parts[0] === "premium" && parts[1] === "series") {
    const market = url.searchParams.get("market") ?? marketPda().toBase58();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 5_000);
    const points = rows(
      db,
      `SELECT slot, source, block_time AS blockTime, index_value AS indexValue
       FROM premium_points WHERE market = ? ORDER BY slot LIMIT ?`,
      market,
      limit
    );
    return {
      status: 200,
      body: {
        watermark: wm,
        market,
        // Every point is a decoded LongMinted.entry_index or a GlobalPremiumIndex
        // account read. Gaps stay gaps: nothing here is interpolated or invented.
        points,
      },
    };
  }

  // GET /liquidations
  if (parts.length === 1 && parts[0] === "liquidations") {
    return {
      status: 200,
      body: {
        watermark: wm,
        // Empty until P4 ships force-exercise and liquidation on-chain. The table
        // exists so this route's shape never changes when it does.
        liquidations: rows(
          db,
          `SELECT signature, log_index AS logIndex, market, owner, perma_position AS permaPosition, kind, slot,
                  block_time AS blockTime FROM liquidations ORDER BY slot DESC`
        ),
      },
    };
  }

  return { status: 404, body: { error: "not found" } };
}
