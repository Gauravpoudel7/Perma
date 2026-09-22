/**
 * Fold fixtures through `rebuild` and serve them through the real route handler.
 *
 * Field names and orders come from `docs/03-api-interfaces/EVENT-CATALOG.md` and
 * the IDL at `apps/web/src/idl/perma.json` (camelCase, as Anchor's TS client
 * reports them). No chain, no RPC — this file is about the fold, not the ingest.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { openDb, getWatermark, rewindWatermark, setMeta, type Db } from "../src/db.ts";
import { rebuild } from "../src/projections.ts";
import { handle } from "../src/routes.ts";

const MARKET = "MKT1111111111111111111111111111111111111111";
const OWNER = "OWN1111111111111111111111111111111111111111";
const SHORT_POS = "SHRT111111111111111111111111111111111111111";
const LONG_POS = "LONG111111111111111111111111111111111111111";

interface Fixture {
  sig: string;
  logIndex?: number;
  name: string;
  slot: number;
  blockTime?: number;
  data: Record<string, unknown>;
}

/** A full short-then-long lifecycle in one range: deposit, mint, settle, burn. */
const FIXTURES: Fixture[] = [
  {
    sig: "sigDeposit",
    name: "CollateralDeposited",
    slot: 10,
    blockTime: 1000,
    data: { market: MARKET, owner: OWNER, amountA: "0", amountB: "5000000", balanceA: "0", balanceB: "5000000" },
  },
  {
    sig: "sigShortMint",
    name: "CollateralLocked",
    slot: 20,
    blockTime: 2000,
    data: { market: MARKET, owner: OWNER, amountA: "0", amountB: "1000000", lockedA: "0", lockedB: "1000000" },
  },
  {
    sig: "sigShortMint",
    logIndex: 1,
    name: "ShortMinted",
    slot: 20,
    blockTime: 2000,
    data: {
      market: MARKET,
      owner: OWNER,
      permaPosition: SHORT_POS,
      orcaPosition: "ORCA11111111111111111111111111111111111111",
      tickLower: -128,
      tickUpper: 128,
      liquidity: "1000000000000000000000",
      lockedA: "0",
      lockedB: "1000000",
      openPositions: 1,
    },
  },
  {
    sig: "sigLongMint",
    name: "LongMinted",
    slot: 30,
    blockTime: 3000,
    data: {
      market: MARKET,
      owner: OWNER,
      permaPosition: LONG_POS,
      tickLower: -128,
      tickUpper: 128,
      size: "400000000000000000000",
      entryIndex: "123456789",
      totalShortLiquidity: "1000000000000000000000",
      totalLongLiquidity: "400000000000000000000",
      availableAfter: "600000000000000000000",
    },
  },
  {
    sig: "sigSettle",
    name: "PremiumSettled",
    slot: 40,
    blockTime: 4000,
    data: {
      market: MARKET,
      owner: OWNER,
      permaPosition: LONG_POS,
      legType: 1,
      amount: "2500",
      stillOwed: "0",
      premiumPool: "2500",
      premiumOwedUsdc: "0",
    },
  },
  {
    sig: "sigLongBurn",
    name: "LongBurned",
    slot: 50,
    blockTime: 5000,
    data: {
      market: MARKET,
      owner: OWNER,
      permaPosition: LONG_POS,
      size: "400000000000000000000",
      premiumPaidUsdc: "1500",
      totalLongLiquidity: "0",
      availableAfter: "1000000000000000000000",
    },
  },
  {
    sig: "sigShortBurn",
    name: "ShortBurned",
    slot: 60,
    blockTime: 6000,
    data: {
      market: MARKET,
      owner: OWNER,
      permaPosition: SHORT_POS,
      liquidity: "1000000000000000000000",
      unlockedA: "0",
      unlockedB: "1000000",
      returnedA: "0",
      returnedB: "1000000",
      premiumClaimed: "4000",
      premiumReceivable: "0",
      status: 1,
      openPositions: 0,
    },
  },
];

function seed(db: Db, fixtures: Fixture[] = FIXTURES): number {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO raw_events (signature, log_index, name, slot, block_time, payload) VALUES (?,?,?,?,?,?)`
  );
  let inserted = 0;
  for (const f of fixtures) {
    const res = ins.run(f.sig, f.logIndex ?? 0, f.name, f.slot, f.blockTime ?? null, JSON.stringify(f.data));
    inserted += Number(res.changes);
  }
  return inserted;
}

function freshDb(): Db {
  const db = openDb(":memory:");
  seed(db);
  rebuild(db);
  setMeta(db, "watermark_slot", "60");
  setMeta(db, "watermark_signature", "sigShortBurn");
  // The last slot the sweep looked at, which is ahead of the last slot PERMA
  // emitted anything in. `/health` measures lag against this one.
  setMeta(db, "swept_through_slot", "90");
  return db;
}

function snapshot(db: Db): string {
  const dump = (sql: string) => JSON.stringify(db.prepare(sql).all());
  return [
    dump("SELECT * FROM positions ORDER BY perma_position"),
    dump("SELECT * FROM collateral ORDER BY owner"),
    dump("SELECT * FROM range_buckets ORDER BY tick_lower"),
    dump("SELECT * FROM settlements ORDER BY signature, log_index"),
    dump("SELECT * FROM collateral_events ORDER BY signature, log_index"),
    dump("SELECT * FROM premium_points ORDER BY slot, source"),
  ].join("\n");
}

test("fold produces one closed short and one closed long with their signatures", () => {
  const db = freshDb();
  const short = db.prepare("SELECT * FROM positions WHERE perma_position = ?").get(SHORT_POS) as any;
  const long = db.prepare("SELECT * FROM positions WHERE perma_position = ?").get(LONG_POS) as any;

  assert.equal(short.leg_type, 0);
  assert.equal(short.size, "0");
  assert.equal(short.status, 1);
  assert.equal(short.open_signature, "sigShortMint");
  assert.equal(short.close_signature, "sigShortBurn");
  assert.equal(short.premium_claimed, "4000");

  assert.equal(long.leg_type, 1);
  assert.equal(long.status, 1);
  assert.equal(long.entry_index, "123456789");
  // 2500 settled while open + 1500 paid at burn.
  assert.equal(long.premium_paid, "4000");
  db.close();
});

test("u128 liquidity survives the round trip without precision loss", () => {
  const db = openDb(":memory:");
  seed(db, FIXTURES.slice(0, 3)); // deposit, lock, short mint — nothing burned yet
  rebuild(db);
  const bucket = db.prepare("SELECT * FROM range_buckets").get() as any;
  assert.equal(bucket.short_liquidity, "1000000000000000000000");
  assert.equal(BigInt(bucket.short_liquidity), 10n ** 21n);
  db.close();
});

test("buckets net to zero after both legs burn", () => {
  const db = freshDb();
  const bucket = db.prepare("SELECT * FROM range_buckets").get() as any;
  assert.equal(bucket.short_liquidity, "0");
  assert.equal(bucket.long_liquidity, "0");
  db.close();
});

test("replaying the whole log changes nothing (gap recovery is a no-op)", () => {
  const db = freshDb();
  const before = snapshot(db);

  rewindWatermark(db);
  assert.equal(getWatermark(db).slot, 0);
  assert.equal(getWatermark(db).signature, null);

  // Re-sweeping re-sees every event; the primary key absorbs the duplicates.
  const insertedOnReplay = seed(db);
  assert.equal(insertedOnReplay, 0, "re-ingest must not insert a second copy");
  rebuild(db);

  assert.equal(snapshot(db), before, "projections must be identical after replay");
  db.close();
});

test("premium series carries only real points, never an interpolated one", async () => {
  const db = freshDb();
  const { status, body } = await handle(db, new URL(`http://x/v1/premium/series?market=${MARKET}`));
  assert.equal(status, 200);
  const points = (body as any).points;
  // One LongMinted in the fixtures → exactly one point. No smoothing, no fill.
  assert.equal(points.length, 1);
  assert.equal(points[0].source, "event");
  assert.equal(points[0].indexValue, "123456789");
  assert.equal(points[0].slot, 30);
  for (const p of points) assert.ok(p.source === "event" || p.source === "poll");
  db.close();
});

test("premium series is empty rather than fabricated when nothing is indexed", async () => {
  const db = openDb(":memory:");
  const { body } = await handle(db, new URL(`http://x/v1/premium/series?market=${MARKET}`));
  assert.deepEqual((body as any).points, []);
  db.close();
});

test("liquidations is always empty in P2 and keeps its shape", async () => {
  const db = freshDb();
  const { status, body } = await handle(db, new URL("http://x/v1/liquidations"));
  assert.equal(status, 200);
  assert.deepEqual((body as any).liquidations, []);
  assert.ok((body as any).watermark);
  db.close();
});

test("health lags against the swept head, not against the last PERMA event", async () => {
  const db = freshDb();
  const { body } = await handle(db, new URL("http://x/v1/health"), { finalizedSlot: async () => 100 });
  assert.equal((body as any).watermarkSlot, 60);
  assert.equal((body as any).sweptThroughSlot, 90);
  assert.equal((body as any).finalizedSlot, 100);
  // 10, not 40: a quiet chain is not a lagging indexer.
  assert.equal((body as any).lagSlots, 10);
  assert.equal((body as any).eventCount, FIXTURES.length);

  const offline = await handle(db, new URL("http://x/v1/health"));
  assert.equal((offline.body as any).finalizedSlot, null);
  assert.equal((offline.body as any).lagSlots, null);
  db.close();
});

test("history returns closed positions, settlements and cash events with tx sigs", async () => {
  const db = freshDb();
  const { body } = await handle(db, new URL(`http://x/v1/positions/${OWNER}/history`));
  const h = body as any;
  assert.equal(h.closedPositions.length, 2);
  assert.equal(h.settlements.length, 1);
  assert.equal(h.settlements[0].signature, "sigSettle");
  assert.deepEqual(h.liquidations, []);
  // deposit + lock
  assert.equal(h.collateral.length, 2);
  for (const row of [...h.closedPositions, ...h.settlements, ...h.collateral]) {
    assert.ok(row.signature ?? row.closeSignature, "every history row needs a signature for the explorer link");
  }
  db.close();
});

test("open positions exclude closed ones", async () => {
  const db = openDb(":memory:");
  seed(db, FIXTURES.slice(0, 4)); // through the long mint, nothing burned
  rebuild(db);
  const { body } = await handle(db, new URL(`http://x/v1/positions/${OWNER}`));
  assert.equal((body as any).positions.length, 2);

  const closedDb = freshDb();
  const after = await handle(closedDb, new URL(`http://x/v1/positions/${OWNER}`));
  assert.equal((after.body as any).positions.length, 0);
  db.close();
  closedDb.close();
});

test("unknown routes 404 and there is no write surface", async () => {
  const db = freshDb();
  assert.equal((await handle(db, new URL("http://x/v1/nope"))).status, 404);
  assert.equal((await handle(db, new URL("http://x/v1/markets/unknown"))).status, 404);
  db.close();
});

test("a burn with no mint in the log marks the history incomplete", async () => {
  const complete = freshDb();
  assert.equal(((await handle(complete, new URL("http://x/v1/health"))).body as any).historyComplete, true);
  complete.close();

  // What a pruned RPC ledger looks like: the burn arrives, its mint never did.
  const db = openDb(":memory:");
  seed(db, FIXTURES.filter((f) => f.name !== "ShortMinted"));
  rebuild(db);
  const { body } = await handle(db, new URL("http://x/v1/health"));
  assert.equal((body as any).historyComplete, false, "an unattributable burn must not be silently swallowed");
  assert.equal((body as any).unattributedBurns, 1);

  // And the incompleteness rides along on the data routes, not only on /health.
  const markets = await handle(db, new URL(`http://x/v1/markets/${MARKET}`));
  assert.equal((markets.body as any).watermark.historyComplete, false);
  db.close();
});
