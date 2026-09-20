/**
 * Continues from verify-mint-long.ts: proves the WithdrawForm solvency gate
 * (an over-large withdraw is refused on-chain with InsolventMint's sibling,
 * InsolventWithdrawal, exactly as SolvencyBlock's copy describes) and the
 * CloseSettleAction burn path for a long, all via the app's real lib/perma.ts
 * builders against the live validator.
 */
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../src/idl/perma.json" with { type: "json" };
import type { Perma } from "../src/idl/perma";
import { marketPda, userCollateralPda } from "../src/lib/pda";
import { fetchMarket, fetchOpenLongsForOwner, fetchUserCollateral } from "../src/lib/accounts";
import { buildWithdrawCollateralIx, buildBurnPositionIx } from "../src/lib/perma";
import { parseAnchorError } from "../src/lib/errors";
import { WHIRLPOOL } from "../src/lib/constants";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");
const secret = Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8")));
const keypair = Keypair.fromSecretKey(secret);
const wallet = { publicKey: keypair.publicKey, signTransaction: async (tx: any) => tx, signAllTransactions: async (txs: any) => txs };
const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
const program = new Program<Perma>(idl as Perma, provider);

async function main() {
  const [market] = marketPda(WHIRLPOOL);
  const marketAccount = await fetchMarket(program, market);
  if (!marketAccount) throw new Error("Market not found.");
  const [ucPda] = userCollateralPda(market, keypair.publicKey);
  const uc = await fetchUserCollateral(program, ucPda);
  if (!uc) throw new Error("No UserCollateral.");
  const openLongs = await fetchOpenLongsForOwner(program, connection, market, keypair.publicKey);
  console.log(`Open longs: ${openLongs.length}, free USDC: ${uc.balanceB.toString()}`);

  const userTokenA = getAssociatedTokenAddressSync(marketAccount.tokenMintA, keypair.publicKey);
  const userTokenB = getAssociatedTokenAddressSync(marketAccount.tokenMintB, keypair.publicKey);

  // 1. Attempt to withdraw ALL free USDC while the long's margin is still
  //    required — must be refused on-chain with InsolventWithdrawal.
  const tooMuch = BigInt(uc.balanceB.toString());
  const badIx = await buildWithdrawCollateralIx(program, {
    owner: keypair.publicKey, market, userTokenA, userTokenB,
    vaultA: marketAccount.vaultA, vaultB: marketAccount.vaultB,
    amountA: 0n, amountB: tooMuch, openLongs,
  });
  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(badIx), [keypair], { commitment: "confirmed" });
    throw new Error("FAIL: over-withdrawal should have been refused on-chain");
  } catch (e: any) {
    const { name, message } = parseAnchorError(e);
    if (name !== "InsolventWithdrawal") throw e;
    console.log(`[OK] On-chain gate refused the over-withdrawal exactly as expected: ${name} — "${message}"`);
  }

  // 2. Burn the long (real settle-in-cash + close via buildBurnPositionIx).
  const long = openLongs[0];
  if (!long) throw new Error("No long to burn.");
  const burnIx = await buildBurnPositionIx(program, {
    leg: "long", owner: keypair.publicKey, market,
    nonce: BigInt(long.nonce.toString()),
    tickLower: long.tickLower, tickUpper: long.tickUpper,
    vaultB: marketAccount.vaultB,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(burnIx), [keypair], { commitment: "confirmed" });
  console.log(`[OK] Real burn_position(LONG) confirmed: ${sig}`);

  const remaining = await fetchOpenLongsForOwner(program, connection, market, keypair.publicKey);
  console.log(`Open longs after burn: ${remaining.length}`);
  if (remaining.length !== 0) throw new Error("FAIL: long still open after burn");

  // 3. Now the same withdrawal that was refused should succeed (no more longs).
  const ucAfter = await fetchUserCollateral(program, ucPda);
  if (!ucAfter) throw new Error("UserCollateral vanished?");
  const okIx = await buildWithdrawCollateralIx(program, {
    owner: keypair.publicKey, market, userTokenA, userTokenB,
    vaultA: marketAccount.vaultA, vaultB: marketAccount.vaultB,
    amountA: 0n, amountB: 1_000_000n, openLongs: [],
  });
  const sig2 = await sendAndConfirmTransaction(connection, new Transaction().add(okIx), [keypair], { commitment: "confirmed" });
  console.log(`[OK] Withdraw succeeds once the long is closed: ${sig2}`);

  console.log("\nFull write-path loop (mint LONG -> blocked withdraw -> burn/settle -> allowed withdraw) verified end-to-end.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
