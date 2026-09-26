// Localnet only (ADR-0004): post a healthy SOL/USD reference at the cloned
// pool's spot through the mock Pyth receiver, so `mint_position` passes its
// oracle gate. Same writer as tests/oracle-mock.ts (tag 0).
//
//   node scripts/mock-price.mjs          # post once
//   node scripts/mock-price.mjs --loop   # re-post every 20 s (keeps the web UI minting)
//
// Needs ANCHOR_PROVIDER_URL / ANCHOR_WALLET like the other scripts. Refuses
// anything but a local RPC: the mock does not exist on devnet or mainnet.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

/** Host only: an RPC URL can carry an API key in its path or query. */
const rpcHost = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "<rpc>";
  }
};

const RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const POOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const EXPO = -8;
export const PRICE_UPDATE = PublicKey.findProgramAddressSync([Buffer.from("price_feed"), FEED, Buffer.from([0])], RECEIVER)[0];

/** Post price = pool spot, conf = 0.1 %, age 0. Returns the price-update address. */
export async function postFreshPrice(conn, payer) {
  const d = (await conn.getAccountInfo(POOL)).data;
  const s = (d.readBigUInt64LE(65) | (d.readBigUInt64LE(73) << 64n)) >> 32n;
  const price = (s * s * 10n ** BigInt(3 - EXPO)) >> 64n;
  const data = Buffer.alloc(8 + 32 + 1 + 8 + 8 + 4 + 8 + 1);
  let off = createHash("sha256").update("global:set_price").digest().copy(data, 0, 0, 8);
  off += FEED.copy(data, off);
  off = data.writeUInt8(0, off);
  off = data.writeBigInt64LE(price, off);
  off = data.writeBigUInt64LE(price / 1000n, off);
  off = data.writeInt32LE(EXPO, off);
  off = data.writeBigInt64LE(0n, off);
  data.writeUInt8(1, off);
  const ix = new TransactionInstruction({
    programId: RECEIVER,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: PRICE_UPDATE, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer], { commitment: "confirmed" });
  return PRICE_UPDATE;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error(`mock-price: refusing non-local RPC ${rpcHost(url)}`);
  const wallet = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace("~", process.env.HOME);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(wallet, "utf8"))));
  const conn = new Connection(url, "confirmed");
  do {
    await postFreshPrice(conn, payer);
    console.log(`${new Date().toISOString()} posted ${PRICE_UPDATE.toBase58()}`);
    if (process.argv.includes("--loop")) await new Promise((r) => setTimeout(r, 20_000));
  } while (process.argv.includes("--loop"));
}
