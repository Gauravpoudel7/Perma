/**
 * Derive every read-model table from `raw_events` in one deterministic pass.
 *
 * Why a full rebuild instead of incremental updates: a replay (watermark rewind,
 * re-ingested page, restarted process) must not double count, and proving that
 * for a dozen incremental `UPDATE ... SET x = x + ?` statements is a lot more
 * work than re-folding the log. The log is the truth; these tables are a cache.
 *
 * ponytail: O(total events) rebuild per ingest batch with new rows. Fine for a
 * single-pool localnet prototype. Switch to incremental folds keyed on a
 * `projected_through` watermark if the event count ever makes this hurt.
 *
 * Ordering is `(slot, signature, log_index)`. Within one slot the signature
 * ordering is arbitrary but stable — no PERMA projection depends on the relative
 * order of two transactions that landed in the same slot.
 */

import { setMeta, type Db } from "./db.ts";

export const LEG_SHORT = 0;
export const LEG_LONG = 1;
export const STATUS_OPEN = 0;

interface RawRow {
  signature: string;
  log_index: number;
  name: string;
  slot: number;
  block_time: number | null;
  payload: string;
}

interface PositionAcc {
  permaPosition: string;
  market: string;
  owner: string;
  legType: number;
  tickLower: number;
  tickUpper: number;
  size: bigint;
  entryIndex: string | null;
  status: number;
  premiumPaid: bigint;
  premiumClaimed: bigint;
  stillOwed: bigint;
  openSlot: number | null;
  openSignature: string | null;
  closeSlot: number | null;
  closeSignature: string | null;
  lastSettleSlot: number | null;
}

interface CollateralAcc {
  market: string;
  owner: string;
  balanceA: bigint;
  balanceB: bigint;
  lockedA: bigint;
  lockedB: bigint;
  premiumPaid: bigint;
  premiumEarned: bigint;
  stillOwed: bigint;
  lastSlot: number;
}

interface BucketAcc {
  market: string;
  tickLower: number;
  tickUpper: number;
  short: bigint;
  long: bigint;
  lastSlot: number;
}

const big = (v: unknown): bigint => BigInt(String(v ?? "0"));
/** Liquidity can never go negative; a negative here means a lost mint event. */
const sub = (a: bigint, b: bigint): bigint => (a > b ? a - b : 0n);

export function rebuild(db: Db): void {
  const rows = db
    .prepare("SELECT signature, log_index, name, slot, block_time, payload FROM raw_events ORDER BY slot, signature, log_index")
    .all() as unknown as RawRow[];

  const positions = new Map<string, PositionAcc>();
  const collateral = new Map<string, CollateralAcc>();
  const buckets = new Map<string, BucketAcc>();
  const premiumPoints: Array<[string, number, string, number | null, string]> = [];
  /**
   * Two independent truncation signals. An RPC that has pruned blocks, or a
   * database seeded mid-life, produces a fold whose sums are quietly too small,
   * so the API must be able to say "incomplete" rather than serve a wrong number.
   *
   * `unattributedBurns` catches a burn whose mint is missing. `genesisMarkets`
   * catches the worse case the burn check cannot see: a mint that was pruned and
   * never burned. `MarketCreated` is emitted exactly once per market, so a log
   * that lacks it demonstrably does not start at the beginning of that market.
   */
  let unattributedBurns = 0;
  const genesisMarkets = new Set<string>();
  const settlements: unknown[][] = [];
  const collateralEvents: unknown[][] = [];

  const bucketOf = (market: string, tickLower: number, tickUpper: number): BucketAcc => {
    const key = `${market}|${tickLower}|${tickUpper}`;
    let b = buckets.get(key);
    if (!b) {
      b = { market, tickLower, tickUpper, short: 0n, long: 0n, lastSlot: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  const collateralOf = (market: string, owner: string): CollateralAcc => {
    const key = `${market}|${owner}`;
    let c = collateral.get(key);
    if (!c) {
      c = {
        market,
        owner,
        balanceA: 0n,
        balanceB: 0n,
        lockedA: 0n,
        lockedB: 0n,
        premiumPaid: 0n,
        premiumEarned: 0n,
        stillOwed: 0n,
        lastSlot: 0,
      };
      collateral.set(key, c);
    }
    return c;
  };

  for (const row of rows) {
    const d = JSON.parse(row.payload) as Record<string, any>;
    const { slot, signature, block_time: blockTime } = row;

    switch (row.name) {
      case "ShortMinted":
      case "LongMinted": {
        const isLong = row.name === "LongMinted";
        const key = d.permaPosition as string;
        let p = positions.get(key);
        if (!p) {
          p = {
            permaPosition: key,
            market: d.market,
            owner: d.owner,
            legType: isLong ? LEG_LONG : LEG_SHORT,
            tickLower: d.tickLower,
            tickUpper: d.tickUpper,
            size: 0n,
            entryIndex: null,
            status: STATUS_OPEN,
            premiumPaid: 0n,
            premiumClaimed: 0n,
            stillOwed: 0n,
            openSlot: slot,
            openSignature: signature,
            closeSlot: null,
            closeSignature: null,
            lastSettleSlot: null,
          };
          positions.set(key, p);
        }
        const amount = big(isLong ? d.size : d.liquidity);
        p.size += amount;
        p.status = STATUS_OPEN;
        p.closeSlot = null;
        p.closeSignature = null;

        const b = bucketOf(d.market, d.tickLower, d.tickUpper);
        if (isLong) b.long += amount;
        else b.short += amount;
        b.lastSlot = slot;

        if (isLong && d.entryIndex !== undefined) {
          // `LongMinted.entry_index` *is* GlobalPremiumIndex.current_index at this
          // slot — the only historical index value any event exposes. Real point.
          premiumPoints.push([d.market, slot, "event", blockTime, String(d.entryIndex)]);
          p.entryIndex = String(d.entryIndex);
        }
        break;
      }

      case "ShortBurned":
      case "LongBurned": {
        const p = positions.get(d.permaPosition as string);
        if (!p) {
          unattributedBurns++;
          break;
        }
        const isLong = row.name === "LongBurned";
        const amount = big(isLong ? d.size : d.liquidity);
        p.size = sub(p.size, amount);

        const b = bucketOf(p.market, p.tickLower, p.tickUpper);
        if (isLong) b.long = sub(b.long, amount);
        else b.short = sub(b.short, amount);
        b.lastSlot = slot;

        if (isLong) {
          p.premiumPaid += big(d.premiumPaidUsdc);
          if (p.size === 0n) p.status = 1;
        } else {
          p.premiumClaimed += big(d.premiumClaimed);
          p.stillOwed = big(d.premiumReceivable);
          p.status = Number(d.status);
        }
        if (p.status !== STATUS_OPEN && p.closeSignature === null) {
          p.closeSlot = slot;
          p.closeSignature = signature;
        }
        break;
      }

      case "MarketCreated": {
        genesisMarkets.add(d.market as string);
        break;
      }

      case "PremiumSettled": {
        settlements.push([
          signature,
          row.log_index,
          d.market,
          d.owner,
          d.permaPosition,
          Number(d.legType),
          String(d.amount),
          String(d.stillOwed),
          slot,
          blockTime,
        ]);
        const p = positions.get(d.permaPosition as string);
        if (p) {
          p.lastSettleSlot = slot;
          p.stillOwed = big(d.stillOwed);
          if (Number(d.legType) === LEG_LONG) p.premiumPaid += big(d.amount);
          else p.premiumClaimed += big(d.amount);
        }
        const c = collateralOf(d.market, d.owner);
        if (Number(d.legType) === LEG_LONG) c.premiumPaid += big(d.amount);
        else c.premiumEarned += big(d.amount);
        c.stillOwed = big(d.stillOwed);
        c.lastSlot = slot;
        break;
      }

      case "CollateralDeposited":
      case "CollateralWithdrawn": {
        const c = collateralOf(d.market, d.owner);
        // The event carries post-state balances, so this is a set, not an add.
        c.balanceA = big(d.balanceA);
        c.balanceB = big(d.balanceB);
        c.lastSlot = slot;
        collateralEvents.push([
          signature,
          row.log_index,
          d.market,
          d.owner,
          row.name === "CollateralDeposited" ? "deposit" : "withdraw",
          String(d.amountA),
          String(d.amountB),
          slot,
          blockTime,
        ]);
        break;
      }

      case "CollateralLocked":
      case "CollateralUnlocked": {
        const c = collateralOf(d.market, d.owner);
        c.lockedA = big(d.lockedA);
        c.lockedB = big(d.lockedB);
        c.lastSlot = slot;
        collateralEvents.push([
          signature,
          row.log_index,
          d.market,
          d.owner,
          row.name === "CollateralLocked" ? "lock" : "unlock",
          String(d.amountA),
          String(d.amountB),
          slot,
          blockTime,
        ]);
        break;
      }

      // GlobalConfigInitialized, Market{PauseSet,PauseCleared,RiskParamsSet},
      // AdminTransferred, RangeValidated, RangeUnwound, PositionOpened/Closed,
      // Liquidity{Added,Removed}: kept in raw_events, not projected. Current market
      // config and pause state come from the Market PDA read, which cannot drift.
      default:
        break;
    }
  }

  db.exec("BEGIN");
  try {
    for (const t of ["positions", "collateral", "range_buckets", "settlements", "collateral_events"]) {
      db.exec(`DELETE FROM ${t}`);
    }
    // Only the event-sourced points are re-derivable here. `poll` points are
    // account reads the ingest loop took at the head and can never be recomputed.
    db.exec("DELETE FROM premium_points WHERE source = 'event'");

    const insPos = db.prepare(
      `INSERT INTO positions (perma_position, market, owner, leg_type, tick_lower, tick_upper, size, entry_index,
        status, premium_paid, premium_claimed, still_owed, open_slot, open_signature, close_slot, close_signature,
        last_settle_slot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const p of positions.values()) {
      insPos.run(
        p.permaPosition, p.market, p.owner, p.legType, p.tickLower, p.tickUpper, p.size.toString(), p.entryIndex,
        p.status, p.premiumPaid.toString(), p.premiumClaimed.toString(), p.stillOwed.toString(), p.openSlot,
        p.openSignature, p.closeSlot, p.closeSignature, p.lastSettleSlot
      );
    }

    const insColl = db.prepare(
      `INSERT INTO collateral (market, owner, balance_a, balance_b, locked_a, locked_b, premium_paid,
        premium_earned, still_owed, last_slot) VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    for (const c of collateral.values()) {
      insColl.run(
        c.market, c.owner, c.balanceA.toString(), c.balanceB.toString(), c.lockedA.toString(), c.lockedB.toString(),
        c.premiumPaid.toString(), c.premiumEarned.toString(), c.stillOwed.toString(), c.lastSlot
      );
    }

    const insBucket = db.prepare(
      `INSERT INTO range_buckets (market, tick_lower, tick_upper, short_liquidity, long_liquidity, last_slot)
       VALUES (?,?,?,?,?,?)`
    );
    for (const b of buckets.values()) {
      insBucket.run(b.market, b.tickLower, b.tickUpper, b.short.toString(), b.long.toString(), b.lastSlot);
    }

    const insPoint = db.prepare(
      `INSERT OR REPLACE INTO premium_points (market, slot, source, block_time, index_value) VALUES (?,?,?,?,?)`
    );
    for (const pt of premiumPoints) insPoint.run(...pt);

    const insSettle = db.prepare(
      `INSERT OR REPLACE INTO settlements (signature, log_index, market, owner, perma_position, leg_type, amount,
        still_owed, slot, block_time) VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    for (const s of settlements) insSettle.run(...(s as any[]));

    const insCollEv = db.prepare(
      `INSERT OR REPLACE INTO collateral_events (signature, log_index, market, owner, kind, amount_a, amount_b,
        slot, block_time) VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const e of collateralEvents) insCollEv.run(...(e as any[]));

    setMeta(db, "unattributed_burns", String(unattributedBurns));
    setMeta(db, "genesis_markets", JSON.stringify([...genesisMarkets]));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
