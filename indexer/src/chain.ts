/**
 * Everything that talks to Solana: config, the Anchor client, PDA derivations
 * and the account reads the ingest loop needs.
 *
 * The `Program` is built on a wallet whose signing methods throw. That is the
 * "read-only, never signs" invariant from
 * `docs/09-post-mvp/INDEXER-AND-PRODUCT-UI.md` expressed in code rather than in
 * a comment: there is no key material here, so a signature is not merely
 * forbidden, it is impossible. Anchor only ever needs the provider for reads.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Named ESM exports are not detected on this CJS build; `scripts/reconcile.mjs`
// imports the default and destructures for the same reason.
import anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const { AnchorProvider, EventParser, Program } = anchor;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Prefer the freshly built IDL; fall back to the copy the web app ships. */
function loadIdl(): any {
  for (const p of [join(REPO, "target", "idl", "perma.json"), join(REPO, "apps", "web", "src", "idl", "perma.json")]) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // Try the next candidate; a missing target/ is normal before `anchor build`.
    }
  }
  throw new Error("no perma IDL found in target/idl or apps/web/src/idl");
}

export const IDL = loadIdl();
export const PROGRAM_ID = new PublicKey(IDL.address);

export const config = {
  rpcUrl: process.env.PERMA_RPC_URL ?? process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899",
  dbPath: process.env.PERMA_INDEX_DB ?? join(HERE, "..", "data", "perma-index.db"),
  port: Number(process.env.PERMA_INDEXER_PORT ?? 8787),
  pollMs: Number(process.env.PERMA_INGEST_POLL_MS ?? 5_000),
  /** Allowlisted Whirlpool (Fair is single-pool; `PoolNotAllowlisted` guards the rest). */
  whirlpool: new PublicKey(process.env.PERMA_WHIRLPOOL ?? "2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G"),
};

export function connection(): Connection {
  return new Connection(config.rpcUrl, "finalized");
}

/** A wallet that cannot sign. Anchor needs the shape; the indexer needs the refusal. */
const READ_ONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: () => Promise.reject(new Error("the indexer never signs")),
  signAllTransactions: () => Promise.reject(new Error("the indexer never signs")),
} as any;

/**
 * Anchor camelCases the IDL inside `Program`, so decoded events and accounts
 * come back as `tickLower`, matching `apps/web/src/lib/events.ts`. Building a
 * bare `BorshCoder` would leave Rust's `tick_lower` and split the vocabulary.
 */
export function program(conn: Connection = connection()) {
  return new Program(IDL, new AnchorProvider(conn, READ_ONLY_WALLET, { commitment: "finalized" }));
}

const defaultProgram = program();
export const coder = defaultProgram.coder;
export const eventParser = new EventParser(PROGRAM_ID, coder);

const seed = (s: string) => Buffer.from(s);

export function marketPda(whirlpool: PublicKey = config.whirlpool): PublicKey {
  return PublicKey.findProgramAddressSync([seed("market"), whirlpool.toBuffer()], PROGRAM_ID)[0];
}

export function premiumIndexPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed("premium_index"), market.toBuffer()], PROGRAM_ID)[0];
}

/** `[RANGE, market, tick_lower_le, tick_upper_le]` — little-endian i32, not ASCII. */
export function rangePda(market: PublicKey, tickLower: number, tickUpper: number): PublicKey {
  const le = (t: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(t);
    return b;
  };
  return PublicKey.findProgramAddressSync(
    [seed("range"), market.toBuffer(), le(tickLower), le(tickUpper)],
    PROGRAM_ID
  )[0];
}

/** `fetchNullable`, so a PDA that does not exist yet is `null` rather than a throw. */
const read = (name: string) => (conn: Connection, pda: PublicKey): Promise<any> =>
  (program(conn).account as any)[name].fetchNullable(pda, "finalized");

export const readMarket = read("market");
export const readPremiumIndex = read("globalPremiumIndex");
export const readRangeState = read("rangePremiumState");

/**
 * Anchor hands back `PublicKey`s, `BN`s and `Buffer`s. Store and serve decimal
 * strings for anything wider than a JS number: a `u128` liquidity value silently
 * loses precision the moment it becomes a float, and these numbers gate money.
 */
export function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // BN and anything else exposing a bare `toString` for an integer.
    if (typeof o.toArrayLike === "function" && typeof o.toString === "function") return o.toString();
    if (Buffer.isBuffer(value)) return value.toString("base64");
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}
