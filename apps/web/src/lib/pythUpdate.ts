/**
 * Solana-devnet P3: Hermes → Wormhole `verify_encoded_vaa_v1` → receiver
 * `post_update` → the resulting `PriceUpdateV2` is passed into `mint_position`.
 *
 * PERMA accepts only VerificationLevel::Full (`programs/perma/src/oracle.rs`).
 * `post_update_atomic` stores a partial level, so this module never builds it.
 * A short mint is 1189 of 1232 bytes (ADR-0004), so the post is always a prior
 * transaction, never packed into the mint.
 *
 * Localnet does not come here: the mock receiver is refreshed by
 * `scripts/mock-price.mjs`. The mock is never deployed to Solana-devnet.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Signer,
} from "@solana/web3.js";
import {
  DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS,
  mintExpectsPriceUpdate,
  PERMA_PROGRAM_ID,
  PRICE_UPDATE,
} from "./constants";

/** ADR-0004 SOL/USD feed id. Same bytes on every cluster. */
export const SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const SOL_USD_FEED = Buffer.from(SOL_USD_FEED_ID.slice(2), "hex");

export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const WORMHOLE_PROGRAM_ID = new PublicKey("HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ");
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

/** `sha256("account:PriceUpdateV2")[..8]`, same bytes `oracle.rs` checks. */
const PRICE_UPDATE_V2_DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);
/** `sha256("global:<snake>")[..8]` for the instructions this file builds. */
const DISC = {
  initEncodedVaa: Buffer.from([209, 193, 173, 25, 91, 202, 181, 218]),
  writeEncodedVaa: Buffer.from([199, 208, 110, 177, 150, 76, 118, 42]),
  verifyEncodedVaaV1: Buffer.from([103, 56, 177, 229, 240, 103, 68, 73]),
  closeEncodedVaa: Buffer.from([48, 221, 174, 198, 231, 7, 152, 38]),
  postUpdate: Buffer.from([133, 95, 207, 175, 11, 79, 118, 44]),
  reclaimRent: Buffer.from([218, 200, 19, 197, 227, 89, 192, 22]),
} as const;

/** Matches `MAX_STALENESS_SECS` in `programs/perma/src/oracle.rs`. */
export const MAX_STALENESS_SECS = 60;
/** BPF upgradeable loader program-data header when an authority is set: u32 + u64 + u8 + pubkey. */
export const PROGRAMDATA_HEADER_LEN = 45;
/**
 * Live Solana-devnet ELF size before the P3 upgrade (measured 2026-09-23,
 * slot 502540621). The account is 45 bytes larger. A P3 build is about 604,872 B.
 */
export const PRE_P3_PROGRAM_DATA_LEN = 594_752;
/** EncodedVaa header (disc + status + authority + version + vec length) before the VAA bytes. */
export const ENCODED_VAA_HEADER = 46;
/** Wormhole verify of a full guardian set. Default 200k CU is not enough. */
const VERIFY_CU = 350_000;
/**
 * First write shares a transaction with `createAccount` + `initEncodedVaa`
 * (two signatures, no address lookup table). Later writes are alone.
 * Both stay under the 1232-byte transaction cap.
 */
export const VAA_FIRST_CHUNK = 400;
export const VAA_NEXT_CHUNK = 650;
const ACCUMULATOR_MAGIC = Buffer.from("504e4155", "hex");

const HERMES_DEFAULTS = ["https://pyth.dourolabs.app/hermes", "https://hermes.pyth.network"];

export function hermesBaseUrls(override?: string): string[] {
  const extra = override?.trim().replace(/\/$/, "");
  if (!extra) return [...HERMES_DEFAULTS];
  return [extra, ...HERMES_DEFAULTS.filter((url) => url !== extra)];
}

/** True only when a Solana-devnet mint must carry a real Pyth account. Localnet keeps the mock. */
export function mintPostsFreshPyth(
  cluster: string = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet",
  flag: string | undefined = process.env.NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE
): boolean {
  return cluster === "devnet" && mintExpectsPriceUpdate(cluster, flag);
}

export function sponsoredSolUsdPriceUpdate(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from([0, 0]), SOL_USD_FEED],
    PYTH_PUSH_ORACLE_PROGRAM_ID
  );
  return pda;
}

export interface PriceUpdateView {
  price: number;
  conf: number;
  publishTime: number;
  ageSecs: number;
  fresh: boolean;
}

/** Parse a receiver-owned Full SOL/USD `PriceUpdateV2`. Returns null when it cannot be used. */
export function readPriceUpdateAccount(
  data: Uint8Array,
  owner: PublicKey,
  nowSecs: number
): PriceUpdateView | null {
  const buf = Buffer.from(data);
  if (
    !owner.equals(PYTH_RECEIVER_PROGRAM_ID) ||
    buf.length < 133 ||
    !buf.subarray(0, 8).equals(PRICE_UPDATE_V2_DISC) ||
    buf[40] !== 1 ||
    !buf.subarray(41, 73).equals(SOL_USD_FEED)
  ) {
    return null;
  }
  const expo = buf.readInt32LE(89);
  const publishTime = Number(buf.readBigInt64LE(93));
  const ageSecs = nowSecs - publishTime;
  return {
    price: Number(buf.readBigInt64LE(73)) * 10 ** expo,
    conf: Number(buf.readBigUInt64LE(81)) * 10 ** expo,
    publishTime,
    ageSecs,
    fresh: ageSecs <= MAX_STALENESS_SECS,
  };
}

export function programDataAddress(programAccount: Uint8Array): PublicKey {
  const buf = Buffer.from(programAccount);
  if (buf.length < 36 || buf.readUInt32LE(0) !== 2) {
    throw new Error("Account is not an upgradeable program.");
  }
  return new PublicKey(buf.subarray(4, 36));
}

export function readProgramDataMeta(data: Uint8Array): {
  slot: bigint;
  authority: PublicKey | null;
  elfLen: number;
} {
  const buf = Buffer.from(data);
  if (buf.length < 13 || buf.readUInt32LE(0) !== 3) {
    throw new Error("Account is not upgradeable program data.");
  }
  const slot = buf.readBigUInt64LE(4);
  const tag = buf[12];
  if (tag === 0) return { slot, authority: null, elfLen: buf.length - 13 };
  if (tag !== 1 || buf.length < PROGRAMDATA_HEADER_LEN) {
    throw new Error("Program data authority is unreadable.");
  }
  return {
    slot,
    authority: new PublicKey(buf.subarray(13, 45)),
    elfLen: buf.length - PROGRAMDATA_HEADER_LEN,
  };
}

export async function readProgramElfLen(connection: Connection, programId: PublicKey): Promise<number> {
  const program = await connection.getAccountInfo(programId);
  if (!program) throw new Error(`Program ${programId.toBase58()} is not deployed on this cluster.`);
  const dataPk = programDataAddress(program.data);
  const data = await connection.getAccountInfo(dataPk);
  if (!data) throw new Error(`Program data ${dataPk.toBase58()} is missing.`);
  return readProgramDataMeta(data.data).elfLen;
}

export interface AccumulatorUpdate {
  vaa: Buffer;
  updates: { message: Buffer; proof: Buffer[] }[];
}

export function parseAccumulatorUpdate(data: Buffer): AccumulatorUpdate {
  if (
    data.length < 8 ||
    !data.subarray(0, 4).equals(ACCUMULATOR_MAGIC) ||
    data[4] !== 1 ||
    data[5] !== 0
  ) {
    throw new Error("Hermes payload is not a Pyth accumulator update.");
  }
  let cursor = 6;
  const trailing = data.readUInt8(cursor);
  cursor += 1 + trailing;
  cursor += 1; // proof type
  const vaaSize = data.readUInt16BE(cursor);
  cursor += 2;
  const vaa = Buffer.from(data.subarray(cursor, cursor + vaaSize));
  cursor += vaaSize;
  const numUpdates = data.readUInt8(cursor);
  cursor += 1;
  const updates: { message: Buffer; proof: Buffer[] }[] = [];
  for (let i = 0; i < numUpdates; i++) {
    const messageSize = data.readUInt16BE(cursor);
    cursor += 2;
    const message = Buffer.from(data.subarray(cursor, cursor + messageSize));
    cursor += messageSize;
    const numProofs = data.readUInt8(cursor);
    cursor += 1;
    const proof: Buffer[] = [];
    for (let j = 0; j < numProofs; j++) {
      proof.push(Buffer.from(data.subarray(cursor, cursor + 20)));
      cursor += 20;
    }
    updates.push({ message, proof });
  }
  if (cursor !== data.length) throw new Error("Hermes payload did not end on a proof boundary.");
  return { vaa, updates };
}

export function solUsdUpdate(parsed: AccumulatorUpdate): { message: Buffer; proof: Buffer[] } {
  const found = parsed.updates.find((update) => {
    return update.message.length >= 33 && update.message[0] === 0 && update.message.subarray(1, 33).equals(SOL_USD_FEED);
  });
  if (!found) throw new Error("Hermes update did not include the SOL/USD feed.");
  return found;
}

/** `publish_time` of a PriceFeedMessage: type 1 + feed 32 + price 8 + conf 8 + expo 4, then i64 BE. */
export function messagePublishTime(message: Buffer): number {
  if (message.length < 61) throw new Error("Pyth price message is too short.");
  return Number(message.readBigInt64BE(53));
}

export function splitVaa(vaa: Buffer, first = VAA_FIRST_CHUNK, next = VAA_NEXT_CHUNK): Buffer[] {
  if (vaa.length < 6) throw new Error("Pyth update VAA is too short.");
  const out: Buffer[] = [];
  const n0 = Math.min(first, vaa.length);
  out.push(vaa.subarray(0, n0));
  let offset = n0;
  while (offset < vaa.length) {
    const n = Math.min(next, vaa.length - offset);
    out.push(vaa.subarray(offset, offset + n));
    offset += n;
  }
  return out;
}

function borshBytes(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function writeEncodedVaaData(index: number, chunk: Buffer): Buffer {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(index, 0);
  return Buffer.concat([DISC.writeEncodedVaa, indexBuf, borshBytes(chunk)]);
}

function postUpdateData(message: Buffer, proof: Buffer[], treasuryId: number): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(proof.length, 0);
  return Buffer.concat([DISC.postUpdate, borshBytes(message), count, ...proof, Buffer.from([treasuryId])]);
}

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

export interface SignedIxs {
  ixs: TransactionInstruction[];
  signers: Signer[];
}

export interface PostUpdatePlan {
  txs: SignedIxs[];
  priceUpdate: PublicKey;
  closeIxs: TransactionInstruction[];
}

export async function buildPostUpdatePlan(args: {
  payer: PublicKey;
  update: Buffer;
  rentLamports: (space: number) => Promise<number> | number;
  treasuryId?: number;
}): Promise<PostUpdatePlan> {
  const parsed = parseAccumulatorUpdate(args.update);
  const { message, proof } = solUsdUpdate(parsed);
  const vaa = parsed.vaa;
  const treasuryId = args.treasuryId ?? 0;
  const encodedVaa = Keypair.generate();
  const priceUpdate = Keypair.generate();
  const space = vaa.length + ENCODED_VAA_HEADER;
  const lamports = await args.rentLamports(space);
  const chunks = splitVaa(vaa);
  const guardianIndex = vaa.readUInt32BE(1);
  const guardianSeed = Buffer.alloc(4);
  guardianSeed.writeUInt32BE(guardianIndex, 0);
  const guardianSetPda = PublicKey.findProgramAddressSync(
    [Buffer.from("GuardianSet"), guardianSeed],
    WORMHOLE_PROGRAM_ID
  )[0];
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], PYTH_RECEIVER_PROGRAM_ID)[0];
  const treasury = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), Buffer.from([treasuryId])],
    PYTH_RECEIVER_PROGRAM_ID
  )[0];

  const createIx = SystemProgram.createAccount({
    fromPubkey: args.payer,
    newAccountPubkey: encodedVaa.publicKey,
    lamports,
    space,
    programId: WORMHOLE_PROGRAM_ID,
  });
  const initIx = new TransactionInstruction({
    programId: WORMHOLE_PROGRAM_ID,
    keys: [meta(args.payer, true, false), meta(encodedVaa.publicKey, false, true)],
    data: DISC.initEncodedVaa,
  });
  let offset = 0;
  const writeIxs = chunks.map((chunk) => {
    const ix = new TransactionInstruction({
      programId: WORMHOLE_PROGRAM_ID,
      keys: [meta(args.payer, true, false), meta(encodedVaa.publicKey, false, true)],
      data: writeEncodedVaaData(offset, Buffer.from(chunk)),
    });
    offset += chunk.length;
    return ix;
  });
  const verifyIx = new TransactionInstruction({
    programId: WORMHOLE_PROGRAM_ID,
    keys: [
      meta(args.payer, true, false),
      meta(encodedVaa.publicKey, false, true),
      meta(guardianSetPda, false, false),
    ],
    data: DISC.verifyEncodedVaaV1,
  });
  const postIx = new TransactionInstruction({
    programId: PYTH_RECEIVER_PROGRAM_ID,
    keys: [
      meta(args.payer, true, true),
      meta(encodedVaa.publicKey, false, false),
      meta(config, false, false),
      meta(treasury, false, true),
      meta(priceUpdate.publicKey, true, true),
      meta(SystemProgram.programId, false, false),
      meta(args.payer, true, false),
    ],
    data: postUpdateData(message, proof, treasuryId),
  });

  const first = writeIxs[0];
  if (!first) throw new Error("Pyth update VAA produced no write.");
  const txs: SignedIxs[] = [
    { ixs: [createIx, initIx, first], signers: [encodedVaa] },
    ...writeIxs.slice(1).map((ix) => ({ ixs: [ix], signers: [] as Signer[] })),
    {
      ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: VERIFY_CU }), verifyIx],
      signers: [],
    },
    { ixs: [postIx], signers: [priceUpdate] },
  ];

  const closeIxs = [
    new TransactionInstruction({
      programId: WORMHOLE_PROGRAM_ID,
      keys: [meta(args.payer, true, true), meta(encodedVaa.publicKey, false, true)],
      data: DISC.closeEncodedVaa,
    }),
    new TransactionInstruction({
      programId: PYTH_RECEIVER_PROGRAM_ID,
      keys: [meta(args.payer, true, true), meta(priceUpdate.publicKey, false, true)],
      data: DISC.reclaimRent,
    }),
  ];
  return { txs, priceUpdate: priceUpdate.publicKey, closeIxs };
}

export class HermesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesError";
  }
}

export async function fetchHermesSolUsd(opts?: {
  apiKey?: string;
  urls?: string[];
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const urls = opts?.urls ?? hermesBaseUrls(process.env.PYTH_HERMES_URL);
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts?.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const failures: string[] = [];
  for (const base of urls) {
    const url = new URL(`${base.replace(/\/$/, "")}/v2/updates/price/latest`);
    url.searchParams.append("ids[]", SOL_USD_FEED_ID);
    url.searchParams.set("encoding", "base64");
    let response: Response;
    try {
      // Next 14 caches server `fetch` by default. A cached update is minutes old
      // and every mint built on it fails the 60 s staleness gate.
      response = await fetchImpl(url, { headers, cache: "no-store" });
    } catch (err) {
      failures.push(`${base} (${err instanceof Error ? err.message : "request failed"})`);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      failures.push(`${base} HTTP ${response.status}`);
      continue;
    }
    if (!response.ok) {
      failures.push(`${base} HTTP ${response.status}`);
      continue;
    }
    const body = (await response.json()) as { binary?: { data?: unknown } };
    const row = body.binary?.data;
    if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].length === 0) {
      failures.push(`${base} returned no binary update`);
      continue;
    }
    return Buffer.from(row[0], "base64");
  }
  throw new HermesError(
    `Hermes did not return a SOL/USD update (${failures.join("; ")}). ` +
      "Public Hermes answers HTTP 401 without a key. Set PYTH_API_KEY in the environment that runs Next or the smoke script. Do not commit the key."
  );
}

export async function fetchHermesViaApp(fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetchImpl("/api/pyth/sol-usd", { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { data?: unknown; error?: unknown };
  if (!response.ok || typeof body.data !== "string" || body.data.length === 0) {
    const detail = typeof body.error === "string" ? body.error : `Hermes proxy failed (${response.status}).`;
    throw new HermesError(detail);
  }
  return Buffer.from(body.data, "base64");
}

export const PRE_P3_MINT_ERROR =
  "Solana-devnet is still running the pre-P3 program (594752 bytes). The mint was not sent. Upgrade it with scripts/upgrade-devnet-p3.mjs, then set NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1.";

export const STALE_PYTH_ERROR =
  "The Pyth price on Solana-devnet is older than 60 seconds, and Hermes did not return an update. Set PYTH_API_KEY in apps/web/.env.local (do not commit it) and retry. Nothing was opened.";

export function staleHermesError(ageSecs: number): string {
  return `Hermes returned a SOL/USD update ${ageSecs} seconds old, and PERMA rejects prices older than ${MAX_STALENESS_SECS}. Nothing was sent. Retry in a moment.`;
}

export interface MintPriceResult {
  ok: boolean;
  priceUpdate: PublicKey | null;
  closeIxs: TransactionInstruction[];
  error?: string;
  alreadyToasted?: boolean;
}

/**
 * Localnet: the mock feed, no post. Solana-devnet with the flag off: the
 * configured account, and the mint builder drops it. Solana-devnet with the
 * flag on: a fresh Full update. A sponsored account younger than 60 seconds
 * is used as-is. Otherwise Hermes is posted via `post_update` first.
 */
export async function resolveMintPriceUpdate(args: {
  connection: Connection;
  payer: PublicKey;
  sendTx: (ixs: TransactionInstruction[], signers: Signer[], successMessage: string) => Promise<string | null>;
  /** Optional: send every post transaction behind one wallet approval, in order. */
  sendTxs?: (txs: SignedIxs[], successMessage: string) => Promise<boolean>;
  cluster?: string;
  flag?: string;
  fetchUpdate?: () => Promise<Buffer>;
  nowSecs?: number;
}): Promise<MintPriceResult> {
  const cluster = args.cluster ?? process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";
  const flag = args.flag ?? process.env.NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE;
  if (!mintPostsFreshPyth(cluster, flag)) {
    return { ok: true, priceUpdate: PRICE_UPDATE, closeIxs: [] };
  }
  const elfLen = await readProgramElfLen(args.connection, PERMA_PROGRAM_ID);
  if (elfLen === PRE_P3_PROGRAM_DATA_LEN) {
    return { ok: false, priceUpdate: null, closeIxs: [], error: PRE_P3_MINT_ERROR };
  }
  const configured = PRICE_UPDATE;
  const info = await args.connection.getAccountInfo(configured);
  const now = args.nowSecs ?? Math.floor(Date.now() / 1000);
  const view = info ? readPriceUpdateAccount(info.data, info.owner, now) : null;
  if (view?.fresh) return { ok: true, priceUpdate: configured, closeIxs: [] };

  let bytes: Buffer;
  try {
    const load =
      args.fetchUpdate ??
      (async () => {
        if (typeof window !== "undefined") return fetchHermesViaApp();
        return fetchHermesSolUsd({ apiKey: process.env.PYTH_API_KEY });
      });
    bytes = await load();
  } catch (err) {
    const detail = err instanceof Error ? err.message : STALE_PYTH_ERROR;
    return { ok: false, priceUpdate: null, closeIxs: [], error: detail.includes("PYTH_API_KEY") ? detail : STALE_PYTH_ERROR };
  }

  // Half the on-chain limit: the rest is for signing and the mint itself.
  const ageSecs = now - messagePublishTime(solUsdUpdate(parseAccumulatorUpdate(bytes)).message);
  if (ageSecs > MAX_STALENESS_SECS / 2) {
    return { ok: false, priceUpdate: null, closeIxs: [], error: staleHermesError(ageSecs) };
  }

  const plan = await buildPostUpdatePlan({
    payer: args.payer,
    update: bytes,
    rentLamports: (space) => args.connection.getMinimumBalanceForRentExemption(space),
  });
  if (args.sendTxs) {
    const sent = await args.sendTxs(plan.txs, "Pyth price posted.");
    if (!sent) return { ok: false, priceUpdate: null, closeIxs: plan.closeIxs, alreadyToasted: true };
    return { ok: true, priceUpdate: plan.priceUpdate, closeIxs: plan.closeIxs };
  }
  for (let i = 0; i < plan.txs.length; i++) {
    const tx = plan.txs[i];
    if (!tx) continue;
    const last = i === plan.txs.length - 1;
    const sig = await args.sendTx(tx.ixs, tx.signers, last ? "Pyth price posted." : "Pyth verification posted.");
    if (!sig) {
      return { ok: false, priceUpdate: null, closeIxs: plan.closeIxs, alreadyToasted: true };
    }
  }
  return { ok: true, priceUpdate: plan.priceUpdate, closeIxs: plan.closeIxs };
}

export const DEVNET_SPONSORED_SOL_USD = new PublicKey(DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS);
