import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS,
  LOCALNET_MOCK_PRICE_UPDATE_ADDRESS,
  defaultPriceUpdateAddress,
  mintExpectsPriceUpdate,
} from "../src/lib/constants";
import {
  DEVNET_SPONSORED_SOL_USD,
  ENCODED_VAA_HEADER,
  PRE_P3_PROGRAM_DATA_LEN,
  PYTH_RECEIVER_PROGRAM_ID,
  SOL_USD_FEED_ID,
  VAA_FIRST_CHUNK,
  VAA_NEXT_CHUNK,
  WORMHOLE_PROGRAM_ID,
  buildPostUpdatePlan,
  fetchHermesSolUsd,
  mintPostsFreshPyth,
  parseAccumulatorUpdate,
  programDataAddress,
  readPriceUpdateAccount,
  readProgramDataMeta,
  solUsdUpdate,
  splitVaa,
  sponsoredSolUsdPriceUpdate,
} from "../src/lib/pythUpdate";

const FEED = Buffer.from(SOL_USD_FEED_ID.slice(2), "hex");
const ADMIN = new PublicKey("7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY");

function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function accumulator(vaa: Buffer, message: Buffer, proofs: Buffer[]): Buffer {
  const prefix = Buffer.alloc(10);
  prefix.write("PNAU", 0, "ascii");
  prefix[4] = 1;
  prefix[5] = 0;
  prefix[6] = 0;
  prefix[7] = 0;
  prefix.writeUInt16BE(vaa.length, 8);
  const msgLen = Buffer.alloc(2);
  msgLen.writeUInt16BE(message.length, 0);
  return Buffer.concat([
    prefix,
    vaa,
    Buffer.from([1]),
    msgLen,
    message,
    Buffer.from([proofs.length]),
    ...proofs,
  ]);
}

function priceMessage(): Buffer {
  const message = Buffer.alloc(33);
  message[0] = 0;
  FEED.copy(message, 1);
  return message;
}

describe("Solana-devnet price account", () => {
  it("derives the sponsored SOL/USD feed used in the pool-price report", () => {
    expect(sponsoredSolUsdPriceUpdate().toBase58()).toBe(DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS);
    expect(DEVNET_SPONSORED_SOL_USD.toBase58()).toBe(sponsoredSolUsdPriceUpdate().toBase58());
  });

  it("keeps the localnet mock off the devnet default", () => {
    expect(defaultPriceUpdateAddress("localnet", "")).toBe(LOCALNET_MOCK_PRICE_UPDATE_ADDRESS);
    expect(defaultPriceUpdateAddress("devnet", "  ")).toBe(DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS);
    expect(defaultPriceUpdateAddress("devnet", "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE")).toBe(
      DEVNET_SOL_USD_PRICE_UPDATE_ADDRESS
    );
  });

  it("posts a fresh update only for a Solana-devnet mint that expects the oracle", () => {
    expect(mintPostsFreshPyth("localnet", undefined)).toBe(false);
    expect(mintPostsFreshPyth("devnet", undefined)).toBe(false);
    expect(mintPostsFreshPyth("devnet", "1")).toBe(true);
    expect(mintExpectsPriceUpdate("devnet", "1")).toBe(true);
    expect(mintPostsFreshPyth("localnet", "1")).toBe(false);
  });
});

describe("PriceUpdateV2 reader", () => {
  function account(opts: { full?: boolean; age?: number; feed?: Buffer }): Buffer {
    const buf = Buffer.alloc(133);
    buf.set([34, 241, 35, 99, 157, 126, 244, 205], 0);
    buf[40] = opts.full === false ? 0 : 1;
    (opts.feed ?? FEED).copy(buf, 41);
    buf.writeBigInt64LE(11737000000n, 73);
    buf.writeBigUInt64LE(1750000n, 81);
    buf.writeInt32LE(-8, 89);
    const now = 1_700_000_000;
    buf.writeBigInt64LE(BigInt(now - (opts.age ?? 10)), 93);
    return buf;
  }

  it("accepts a fresh Full SOL/USD update and rejects the gates PERMA rejects", () => {
    const now = 1_700_000_000;
    const ok = readPriceUpdateAccount(account({}), PYTH_RECEIVER_PROGRAM_ID, now);
    expect(ok?.fresh).toBe(true);
    expect(ok?.price).toBeCloseTo(117.37, 4);
    expect(readPriceUpdateAccount(account({ age: 61 }), PYTH_RECEIVER_PROGRAM_ID, now)?.fresh).toBe(false);
    expect(readPriceUpdateAccount(account({ full: false }), PYTH_RECEIVER_PROGRAM_ID, now)).toBeNull();
    expect(readPriceUpdateAccount(account({ feed: Buffer.alloc(32, 1) }), PYTH_RECEIVER_PROGRAM_ID, now)).toBeNull();
    expect(readPriceUpdateAccount(account({}), Keypair.generate().publicKey, now)).toBeNull();
  });
});

describe("upgradeable program data", () => {
  it("reads the 45-byte header used by the live Solana-devnet program", () => {
    const elf = Buffer.alloc(PRE_P3_PROGRAM_DATA_LEN);
    const data = Buffer.alloc(45 + elf.length);
    data.writeUInt32LE(3, 0);
    data.writeBigUInt64LE(502540621n, 4);
    data[12] = 1;
    ADMIN.toBuffer().copy(data, 13);
    elf.copy(data, 45);
    const meta = readProgramDataMeta(data);
    expect(meta.elfLen).toBe(PRE_P3_PROGRAM_DATA_LEN);
    expect(meta.slot).toBe(502540621n);
    expect(meta.authority?.toBase58()).toBe(ADMIN.toBase58());

    const program = Buffer.alloc(36);
    program.writeUInt32LE(2, 0);
    ADMIN.toBuffer().copy(program, 4);
    expect(programDataAddress(program).toBase58()).toBe(ADMIN.toBase58());
  });
});

describe("Hermes accumulator and post_update", () => {
  it("parses one SOL/USD update and ignores a different feed", () => {
    const vaa = Buffer.alloc(6);
    vaa[0] = 1;
    const message = priceMessage();
    const parsed = parseAccumulatorUpdate(accumulator(vaa, message, [Buffer.alloc(20, 7)]));
    expect(parsed.vaa).toEqual(vaa);
    expect(solUsdUpdate(parsed).proof).toHaveLength(1);
    const other = Buffer.alloc(33);
    other[0] = 0;
    expect(() => solUsdUpdate(parseAccumulatorUpdate(accumulator(vaa, other, [])))).toThrow(/SOL\/USD/);
  });

  it("splits a VAA so the mint transaction is not asked to carry it", () => {
    const vaa = Buffer.alloc(VAA_FIRST_CHUNK + VAA_NEXT_CHUNK + 10);
    const parts = splitVaa(vaa);
    expect(parts.map((part) => part.length)).toEqual([VAA_FIRST_CHUNK, VAA_NEXT_CHUNK, 10]);
  });

  it("builds a full post_update, never post_update_atomic, in transactions before the mint", async () => {
    const vaa = Buffer.alloc(80);
    vaa[0] = 1;
    vaa.writeUInt32BE(3, 1);
    const proof = Buffer.alloc(20, 9);
    const update = accumulator(vaa, priceMessage(), [proof]);
    const payer = Keypair.generate().publicKey;
    const plan = await buildPostUpdatePlan({
      payer,
      update,
      rentLamports: () => 1_000_000,
      treasuryId: 0,
    });

    expect(plan.txs.length).toBe(3);
    expect(plan.txs[0]?.signers).toHaveLength(1);
    expect(plan.txs[2]?.signers).toHaveLength(1);
    expect(plan.txs[2]?.signers[0]?.publicKey.equals(plan.priceUpdate)).toBe(true);
    expect(plan.closeIxs).toHaveLength(2);

    const atomic = disc("post_update_atomic");
    const post = disc("post_update");
    const verify = disc("verify_encoded_vaa_v1");
    const flat = plan.txs.flatMap((tx) => tx.ixs);
    expect(flat.some((ix) => ix.data.includes(atomic))).toBe(false);
    const postIx = flat.find((ix) => ix.programId.equals(PYTH_RECEIVER_PROGRAM_ID));
    expect(postIx?.data.subarray(0, 8).equals(post)).toBe(true);
    expect(postIx?.keys[4]?.pubkey.equals(plan.priceUpdate)).toBe(true);
    expect(postIx?.keys[4]?.isSigner).toBe(true);
    expect(postIx?.keys[5]?.pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(flat.some((ix) => ix.programId.equals(WORMHOLE_PROGRAM_ID) && ix.data.includes(verify))).toBe(true);
    expect(plan.txs.some((tx) => tx.ixs.some((ix) => ix.data.includes(post)) && tx.ixs.length === 1)).toBe(true);

    const space = vaa.length + ENCODED_VAA_HEADER;
    expect(space).toBeGreaterThan(vaa.length);
  });

  it("tries the next Hermes host after HTTP 401", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("dourolabs")) return new Response("unauthorized", { status: 401 });
      return new Response(
        JSON.stringify({ binary: { encoding: "base64", data: [Buffer.from("pyth").toString("base64")] } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const buf = await fetchHermesSolUsd({ fetchImpl, apiKey: "test-key" });
    expect(buf.toString()).toBe("pyth");
    expect(calls[0]).toContain("pyth.dourolabs.app");
    expect(calls[1]).toContain("hermes.pyth.network");
    expect(calls[1]).toContain("ids%5B%5D=0xef0d8b6f");
  });

  it("names the missing key when every Hermes host refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    await expect(fetchHermesSolUsd({ fetchImpl })).rejects.toThrow(/PYTH_API_KEY/);
  });
});
