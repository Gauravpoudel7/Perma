import { EventParser, type Program } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { Perma } from "../idl/perma";

/**
 * Component 11's whole "indexer": decode the Anchor events a confirmed
 * transaction actually emitted, and say which store slices they touched.
 *
 * This is a hint layer, not a source of truth. `useSendPermaTx` still runs its
 * unconditional post-tx refetch and every `use*` hook keeps polling; if
 * `getTransaction` is slow, missing, or the logs don't parse, callers get `[]`
 * and behave exactly as before. The catalog of what each event carries is
 * `docs/03-api-interfaces/EVENT-CATALOG.md`.
 */

/** Event names as Anchor's TS client reports them (camelCase, per the IDL type). */
export type PermaEventName = Perma["events"][number]["name"];

export interface PermaEvent {
  name: PermaEventName;
  data: Record<string, unknown>;
}

/** Log prefixes Anchor's parser accepts; both may carry a base64 event. */
const EVENT_LOG_PREFIXES = ["Program data: ", "Program log: "] as const;

/**
 * Decode every PERMA event in a transaction's log lines. Lines from other
 * programs, plain text, and undecodable payloads are skipped, never thrown.
 */
export function decodePermaEvents(program: Program<Perma>, logs: readonly string[]): PermaEvent[] {
  const parser = new EventParser(program.programId, program.coder);
  const out: PermaEvent[] = [];
  try {
    for (const ev of parser.parseLogs([...logs], false)) {
      out.push({ name: ev.name as PermaEventName, data: ev.data as Record<string, unknown> });
    }
  } catch {
    // A malformed line mid-stream: keep what decoded so far. Best-effort by contract.
  }
  return out;
}

/** `true` if a log line could possibly hold an Anchor event (cheap pre-filter for tests/tools). */
export function looksLikeEventLog(line: string): boolean {
  return EVENT_LOG_PREFIXES.some((p) => line.startsWith(p));
}

/**
 * Fetch a confirmed transaction's logs and decode its PERMA events.
 * Never throws: a null tx (not yet visible on this RPC), missing meta, or a
 * network error all return `[]`.
 */
export async function fetchTxEvents(
  connection: Connection,
  program: Program<Perma>,
  signature: string
): Promise<PermaEvent[]> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs || logs.length === 0) return [];
    return decodePermaEvents(program, logs);
  } catch {
    return [];
  }
}

export interface TouchedSlices {
  market: boolean;
  collateral: boolean;
  positions: boolean;
  premiumIndex: boolean;
  /** Specific ranges named by the events, as `[tickLower, tickUpper]`. */
  ranges: Array<[number, number]>;
  /** Set when an event moved range state without naming the range (e.g. `premiumSettled`). */
  allKnownRanges: boolean;
}

const EMPTY: TouchedSlices = {
  market: false,
  collateral: false,
  positions: false,
  premiumIndex: false,
  ranges: [],
  allKnownRanges: false,
};

function tickRange(data: Record<string, unknown>): [number, number] | null {
  const lo = data.tickLower;
  const hi = data.tickUpper;
  return typeof lo === "number" && typeof hi === "number" ? [lo, hi] : null;
}

/**
 * Pure mapping from decoded events to the store slices worth refetching
 * right now, ahead of the next poll tick. Unknown names touch nothing.
 */
export function slicesTouchedBy(events: readonly PermaEvent[]): TouchedSlices {
  const t: TouchedSlices = { ...EMPTY, ranges: [] };
  const addRange = (data: Record<string, unknown>) => {
    const r = tickRange(data);
    if (r && !t.ranges.some(([a, b]) => a === r[0] && b === r[1])) t.ranges.push(r);
    else if (!r) t.allKnownRanges = true;
  };

  for (const { name, data } of events) {
    switch (name) {
      case "shortMinted":
      case "longMinted":
        t.positions = t.collateral = t.premiumIndex = true;
        addRange(data);
        break;
      case "shortBurned":
      case "longBurned":
      case "premiumSettled":
        t.positions = t.collateral = t.premiumIndex = true;
        addRange(data); // these carry no ticks → allKnownRanges
        break;
      case "collateralDeposited":
      case "collateralWithdrawn":
      case "collateralLocked":
      case "collateralUnlocked":
        t.collateral = true;
        break;
      case "marketCreated":
      case "marketPauseSet":
      case "marketPauseCleared":
      case "marketRiskParamsSet":
        t.market = true;
        break;
      case "positionOpened":
      case "positionClosed":
      case "liquidityAdded":
      case "liquidityRemoved":
        t.positions = true;
        addRange(data);
        break;
      default:
        break;
    }
  }
  return t;
}

/** Human-readable, PascalCase names for a toast line: `ShortMinted, PremiumSettled`. */
export function describeEvents(events: readonly PermaEvent[]): string {
  return events.map((e) => e.name.charAt(0).toUpperCase() + e.name.slice(1)).join(", ");
}
