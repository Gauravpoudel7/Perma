/**
 * Sends a REAL mint_position(LONG) transaction using the app's actual
 * `buildMintPositionIx` builder from src/lib/perma.ts, against the existing
 * SHORT already on the local validator (from tests/position-short.ts). Then
 * re-fetches and prints the resulting state through the same lib/accounts.ts
 * + lib/solvency.ts code paths OpenPositionButton / RequiredFreeUsdcTile use.
 *
 * This exercises the exact WRITE code path a browser wallet would trigger —
 * not a mock, not a re-implementation — with a real Keypair standing in for
 * wallet-adapter's sign/send.
 */
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../src/idl/perma.json" with { type: "json" };
import type { Perma } from "../src/idl/perma";
import { marketPda } from "../src/lib/pda";
import { fetchMarket, fetchOpenLongsForOwner } from "../src/lib/accounts";
import { buildMintPositionIx } from "../src/lib/perma";
import { requiredMargin, requiredFreeUsdc } from "../src/lib/solvency";
import { WHIRLPOOL } from "../src/lib/constants";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");
const secret = Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const wallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx: any) => tx,
  signAllTransactions: async (txs: any) => txs,
};
const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
const program = new Program<Perma>(idl as Perma, provider);

async function main() {
  const [market] = marketPda(WHIRLPOOL);
  const marketAccount = await fetchMarket(program, market);
  if (!marketAccount) throw new Error("Market not found — run the setup suites first.");

  const existingOpenLongs = await fetchOpenLongsForOwner(program, connection, market, keypair.publicKey);
  console.log(`Existing open longs before mint: ${existingOpenLongs.length}`);

  const liquidity = 10_000_000n;
  const margin = requiredMargin(
    {
      longMarginHorizonSlots: BigInt(marketAccount.longMarginHorizonSlots.toString()),
      premiumRate: BigInt(marketAccount.premiumRate.toString()),
      premiumMultiplier: BigInt(marketAccount.premiumMultiplier.toString()),
      longMarginBufferUsdc: BigInt(marketAccount.longMarginBufferUsdc.toString()),
    },
    liquidity
  );
  console.log(`Minting a LONG: liquidity=${liquidity}, required_margin=${margin} µUSDC (real ADR-0003 formula)`);

  const nonce = BigInt(Date.now());
  const ix = await buildMintPositionIx(program, {
    leg: "long",
    owner: keypair.publicKey,
    market,
    tickLower: -40176,
    tickUpper: -38168,
    liquidity,
    nonce,
    existingOpenLongs,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [keypair], { commitment: "confirmed" });
  console.log(`[OK] Real mint_position(LONG) transaction confirmed: ${sig}`);

  const afterLongs = await fetchOpenLongsForOwner(program, connection, market, keypair.publicKey);
  console.log(`Open longs after mint: ${afterLongs.length}`);
  const minted = afterLongs.find((p) => p.nonce.toString() === nonce.toString());
  if (!minted) throw new Error("FAIL: minted position not found in fresh fetch");
  console.log(`[OK] Minted position round-trips through fetchOpenLongsForOwner: liquidity=${minted.liquidity.toString()}, ticks=[${minted.tickLower},${minted.tickUpper}]`);

  const required = requiredFreeUsdc(
    0n,
    afterLongs.map((p) => ({
      accruedScaled: BigInt(p.accruedScaled.toString()),
      entryIndex: BigInt(p.entryIndex.toString()),
      liquidity: BigInt(p.liquidity.toString()),
    })),
    0n,
    {
      longMarginHorizonSlots: BigInt(marketAccount.longMarginHorizonSlots.toString()),
      premiumRate: BigInt(marketAccount.premiumRate.toString()),
      premiumMultiplier: BigInt(marketAccount.premiumMultiplier.toString()),
      longMarginBufferUsdc: BigInt(marketAccount.longMarginBufferUsdc.toString()),
    }
  );
  console.log(`[OK] RequiredFreeUsdcTile's exact formula on real state: ${required} µUSDC (== requiredMargin since no time has elapsed)`);
  if (required !== margin) throw new Error(`Mismatch: expected ${margin}, got ${required}`);
  console.log("\nEnd-to-end LONG mint + solvency read-back verified against a real deployed program.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
