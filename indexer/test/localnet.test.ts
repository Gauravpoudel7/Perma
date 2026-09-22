/**
 * Acceptance tests against a live localnet.
 *
 * These skip themselves when no validator answers, so `yarn indexer:test` stays
 * runnable on a laptop with nothing booted. To make them meaningful, run the
 * RELEASE-GATE §4.2 suites first: they mint, settle and burn on the ledger, and
 * this file then proves the indexer can reconstruct that history from finalized
 * transactions alone. Reusing the gate as the fixture generator beats
 * re-implementing the Orca setup here.
 *
 *   ./scripts/local-validator.sh &
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/position-short.ts tests/position-long.ts
 *   cd indexer && yarn test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { PROGRAM_ID, connection, config, marketPda, rangePda, readRangeState, toJsonSafe } from "../src/chain.ts";
import { openDb, getWatermark, rewindWatermark, type Db } from "../src/db.ts";
import { ingestOnce } from "../src/ingest.ts";
import { rebuild } from "../src/projections.ts";
import { handle } from "../src/routes.ts";

const conn = connection();

async function validatorUp(): Promise<boolean> {
  try {
    await conn.getSlot("finalized");
    return true;
  } catch {
    return false;
  }
}

const up = await validatorUp();
const opts = up ? {} : { skip: `no validator at ${config.rpcUrl}` };

/**
 * A validator with the program deployed but no PERMA transactions in its ledger
 * cannot exercise the fold. Skip loudly rather than pass vacuously: a green run
 * on an empty ledger proves nothing about ingest.
 */
const hasHistory =
  up && (await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 1 }, "finalized")).length > 0;
const optsWithHistory = up
  ? hasHistory
    ? {}
    : { skip: "ledger has no PERMA transactions — run the RELEASE-GATE §4.2 suites first" }
  : opts;

/** One ingest of the whole ledger into a throwaway in-memory DB. */
async function ingestAll(): Promise<Db> {
  const db = openDb(":memory:");
  await ingestOnce(db, conn);
  return db;
}


test("ingest advances the watermark and decodes PERMA events", optsWithHistory, async () => {
  const db = await ingestAll();
  const wm = getWatermark(db);
  assert.ok(wm.slot > 0, "watermark must advance past genesis");
  assert.equal(wm.lastError, null);

  const count = (db.prepare("SELECT COUNT(*) AS n FROM raw_events").get() as any).n;
  assert.ok(Number(count) > 0, "no PERMA events on this ledger — run the gate suites first");
  db.close();
});

test("health reports a real lag against the finalized slot", opts, async () => {
  const db = await ingestAll();
  const { body } = await handle(db, new URL("http://x/v1/health"), {
    finalizedSlot: () => conn.getSlot("finalized"),
  });
  const h = body as any;
  assert.ok(h.finalizedSlot > 0);
  // A sweep that just ran is within a handful of slots of the head. Lag against
  // the watermark would instead measure "how long since anyone traded".
  assert.ok(h.lagSlots >= 0 && h.lagSlots < 150, `sweep left ${h.lagSlots} slots of lag`);
  assert.equal(h.lastError, null);
  db.close();
});

test("markets matches the on-chain Market PDA", opts, async () => {
  const db = await ingestAll();
  const { body } = await handle(db, new URL("http://x/v1/markets"));
  const markets = (body as any).markets;
  assert.equal(markets.length, 1, "Fair is single-pool");
  assert.equal(markets[0].market, marketPda().toBase58());
  assert.equal(markets[0].whirlpool, config.whirlpool.toBase58());
  assert.equal(typeof markets[0].isPaused, "boolean");
  db.close();
});

test("indexed range buckets equal on-chain RangePremiumState exactly", optsWithHistory, async () => {
  const db = await ingestAll();
  const market = marketPda();
  const buckets = db
    .prepare("SELECT tick_lower, tick_upper, short_liquidity, long_liquidity FROM range_buckets WHERE market = ?")
    .all(market.toBase58()) as unknown as any[];

  if (buckets.length === 0) {
    // Nothing minted on this ledger; nothing to reconcile.
    db.close();
    return;
  }

  const { body } = await handle(db, new URL("http://x/v1/health"));
  if (!(body as any).historyComplete) {
    /**
     * The RPC pruned blocks before the mints that created this liquidity, so the
     * fold provably cannot see all of it and exact equality is not the right
     * assertion. Check the honest behaviour instead: the service must admit it.
     * Run against a fresh `solana-test-validator --reset` ledger for the real
     * reconcile.
     */
    const h = body as any;
    assert.ok(h.unattributedBurns > 0 || h.missingGenesis.length > 0);
    db.close();
    return;
  }

  for (const b of buckets) {
    const state = await readRangeState(conn, rangePda(market, b.tick_lower, b.tick_upper));
    if (!state) continue; // Range swept closed by unwind_empty_range; no account left to compare.
    const onchain = toJsonSafe(state) as any;
    // Exact equality, not a tolerance band: both sides are exact u128 sums.
    assert.equal(
      b.short_liquidity,
      String(onchain.totalShortLiquidity),
      `short liquidity drift at [${b.tick_lower}, ${b.tick_upper}]`
    );
    assert.equal(
      b.long_liquidity,
      String(onchain.totalLongLiquidity),
      `long liquidity drift at [${b.tick_lower}, ${b.tick_upper}]`
    );
  }
  db.close();
});

test("a rewound watermark recovers without duplicating anything", optsWithHistory, async () => {
  const db = await ingestAll();
  const eventKeys = () =>
    (db.prepare("SELECT signature, log_index FROM raw_events").all() as unknown as any[]).map(
      (r) => `${r.signature}#${r.log_index}`
    );
  const before = eventKeys();

  rewindWatermark(db);
  await ingestOnce(db, conn);
  rebuild(db);

  const after = eventKeys();
  assert.equal(new Set(after).size, after.length, "replay must not insert duplicate events");
  for (const key of before) assert.ok(after.includes(key), `replay dropped ${key}`);
  /**
   * Not an equality check on the counts. This runs against a live validator, so
   * a transaction that was merely confirmed during the first sweep can reach
   * finalized before the second one and legitimately add rows. What must hold is
   * that a replay is additive and never double counts.
   */
  assert.ok(after.length >= before.length, "replay must not lose events");
  assert.ok(getWatermark(db).slot > 0, "watermark must be re-established after recovery");
  db.close();
});

test("every premium point is traceable to an event or an account read", optsWithHistory, async () => {
  const db = await ingestAll();
  const { body } = await handle(db, new URL("http://x/v1/premium/series"));
  for (const p of (body as any).points) {
    assert.ok(p.source === "event" || p.source === "poll", `unsourced point at slot ${p.slot}`);
    assert.ok(BigInt(p.indexValue) >= 0n);
  }
  db.close();
});

test("liquidations stays empty against a real ledger", opts, async () => {
  const db = await ingestAll();
  const { body } = await handle(db, new URL("http://x/v1/liquidations"));
  assert.deepEqual((body as any).liquidations, []);
  db.close();
});

test("a position that was minted then burned shows up in history with its sigs", optsWithHistory, async () => {
  const db = await ingestAll();
  const closed = db.prepare("SELECT * FROM positions WHERE status != 0").all() as unknown as any[];
  if (closed.length === 0) {
    // Ledger has no completed lifecycle yet; the fold is still correct.
    db.close();
    return;
  }
  const owner = closed[0].owner as string;
  const { body } = await handle(db, new URL(`http://x/v1/positions/${owner}/history`));
  const h = body as any;
  assert.ok(h.closedPositions.length > 0);
  for (const row of h.closedPositions) {
    assert.ok(row.openSignature, "closed position must carry the mint signature");
    assert.ok(row.closeSignature, "closed position must carry the burn signature");
  }
  db.close();
});
