/**
 * Localnet driver for the mock Pyth receiver (ADR-0004). No tests here.
 *
 * The mock is loaded at the real receiver address by
 * scripts/local-validator.sh, so PERMA's owner check passes. Every suite that
 * mints calls `freshPrice` right before the mint: the reference goes stale
 * after 60 s, and suites run for minutes.
 */
import * as anchor from "@coral-xyz/anchor";
import { createHash } from "crypto";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const SOL_USD_FEED = Buffer.from(
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "hex"
);
export const EXPO = -8;
const WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const SET_PRICE = createHash("sha256").update("global:set_price").digest().subarray(0, 8);

/** `["price_feed", feed, tag]`. Tag 0 is the shared healthy feed; the oracle suite uses its own tags. */
export const priceFeed = (tag = 0, feed: Buffer = SOL_USD_FEED) =>
  PublicKey.findProgramAddressSync([Buffer.from("price_feed"), feed, Buffer.from([tag])], PYTH_RECEIVER)[0];

/** Pool spot in Pyth units (USD/SOL × 1e8) - the same formula as `oracle::spot_in_price_units`. */
export async function poolSpotE8(provider: anchor.AnchorProvider): Promise<bigint> {
  const d = (await provider.connection.getAccountInfo(WHIRLPOOL))!.data;
  const sqrt = d.readBigUInt64LE(65) | (d.readBigUInt64LE(73) << 64n); // 65..81 sqrt_price
  const s = sqrt >> 32n;
  return (s * s * 10n ** BigInt(3 - EXPO)) >> 64n;
}

export type PriceOpts = {
  price: bigint;
  conf?: bigint;
  ageSecs?: number;
  full?: boolean;
  tag?: number;
  feed?: Buffer;
};

/** Write a `PriceUpdateV2` via the mock; returns its address. */
export async function setPrice(provider: anchor.AnchorProvider, o: PriceOpts): Promise<PublicKey> {
  const feed = o.feed ?? SOL_USD_FEED;
  const tag = o.tag ?? 0;
  const data = Buffer.alloc(8 + 32 + 1 + 8 + 8 + 4 + 8 + 1);
  let off = SET_PRICE.copy(data, 0);
  off += feed.copy(data, off);
  off = data.writeUInt8(tag, off);
  off = data.writeBigInt64LE(o.price, off);
  off = data.writeBigUInt64LE(o.conf ?? 0n, off);
  off = data.writeInt32LE(EXPO, off);
  off = data.writeBigInt64LE(BigInt(o.ageSecs ?? 0), off);
  data.writeUInt8(o.full === false ? 0 : 1, off);

  const account = priceFeed(tag, feed);
  const ix = new TransactionInstruction({
    programId: PYTH_RECEIVER,
    keys: [
      { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  await provider.sendAndConfirm(new Transaction().add(ix));
  return account;
}

const lastFresh = new Map<number, number>();

/**
 * Healthy reference at the pool's spot, 0.1 % confidence, age 0
 * (`ORACLE_HEALTHY_OK`). Re-posted at most every 20 s: well inside the 60 s
 * staleness limit, and it avoids re-sending a byte-identical transaction.
 */
export async function freshPrice(provider: anchor.AnchorProvider, tag = 0): Promise<PublicKey> {
  if (Date.now() - (lastFresh.get(tag) ?? 0) > 20_000) {
    const price = await poolSpotE8(provider);
    await setPrice(provider, { price, conf: price / 1000n, tag });
    lastFresh.set(tag, Date.now());
  }
  return priceFeed(tag);
}

/** Forget the cache, e.g. after a test overwrote a tag with an unhealthy price. */
export const invalidateFresh = (tag = 0) => lastFresh.delete(tag);
