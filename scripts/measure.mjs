#!/usr/bin/env node
/**
 * Measure real CU and serialized transaction size for the liquidity CPI path,
 * and cross-check observed token deltas against the Whirlpool math.
 *
 * Usage (validator must be running with fixtures):
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
 *   ANCHOR_WALLET=~/.config/solana/id.json node scripts/measure.mjs
 */
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { readFileSync } from "fs";

const { AnchorProvider, Program, Wallet, web3 } = anchor;

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const POOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const ORCA_VAULT_A = new PublicKey("3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4");
const ORCA_VAULT_B = new PublicKey("63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const TICK_SPACING = 8, TICK_ARRAY_SIZE = 88, LOWER = -40176, UPPER = -38168;
const L = new BN(100_000_000);

const start = (t) => Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const taPda = (t) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), POOL.toBuffer(), Buffer.from(start(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(process.env.ANCHOR_WALLET.replace("~", process.env.HOME), "utf8")))
);
const conn = new web3.Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("target/idl/perma.json", "utf8"));
const program = new Program(idl, provider);

const market = PublicKey.findProgramAddressSync([Buffer.from("market"), POOL.toBuffer()], program.programId)[0];
const auth = PublicKey.findProgramAddressSync([Buffer.from("market_authority"), market.toBuffer()], program.programId)[0];

const nonce = new BN(Date.now() % 1_000_000_000);
const mint = Keypair.generate();
const orcaPos = PublicKey.findProgramAddressSync([Buffer.from("position"), mint.publicKey.toBuffer()], WHIRLPOOL_PROGRAM)[0];
const posAta = PublicKey.findProgramAddressSync([auth.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.publicKey.toBuffer()], ATA_PROGRAM)[0];
const permaPos = PublicKey.findProgramAddressSync(
  [Buffer.from("perma_position"), market.toBuffer(), kp.publicKey.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
  program.programId
)[0];

const amt = async (pk) => (await conn.getAccountInfo(pk)).data.readBigUInt64LE(64);
const cuOf = (logs) => {
  for (const l of logs ?? []) {
    const m = l.match(/consumed (\d+) of \d+ compute units/);
    if (m && l.includes(program.programId.toBase58())) return Number(m[1]);
  }
  return null;
};

async function sizeAndSend(builder, signers = []) {
  const tx = await builder.transaction();
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp, ...signers);
  const size = tx.serialize().length;
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  const parsed = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return { size, cu: cuOf(parsed?.meta?.logMessages), accounts: tx.compileMessage().accountKeys.length };
}

console.log("=== open_position ===");
const o = await sizeAndSend(
  program.methods.adapterOpenPosition(LOWER, UPPER, nonce).accounts({
    owner: kp.publicKey, market, marketAuthority: auth, permaPosition: permaPos,
    whirlpool: POOL, orcaPosition: orcaPos, positionMint: mint.publicKey,
    positionTokenAccount: posAta, tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).signers([mint]),
  [mint]
);
console.log(`  tx bytes ${o.size} / 1232   unique accounts ${o.accounts}   CU ${o.cu}`);

const liqAccts = {
  owner: kp.publicKey, market, marketAuthority: auth, permaPosition: permaPos,
  whirlpool: POOL, orcaPosition: orcaPos, positionTokenAccount: posAta,
  tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
  orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
  tickArrayLower: taPda(LOWER), tickArrayUpper: taPda(UPPER),
  tokenProgramA: TOKEN_PROGRAM, tokenProgramB: TOKEN_PROGRAM,
  memoProgram: MEMO, whirlpoolProgram: WHIRLPOOL_PROGRAM,
};

const bA = await amt(VAULT_A), bB = await amt(VAULT_B);
console.log("=== increase_liquidity_v2 ===");
const a = await sizeAndSend(
  program.methods.adapterAddLiquidity(LOWER, UPPER, L, new BN(1e9), new BN(1e8))
    .accounts(liqAccts)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
);
const spentA = bA - (await amt(VAULT_A)), spentB = bB - (await amt(VAULT_B));
console.log(`  tx bytes ${a.size} / 1232   unique accounts ${a.accounts}   CU ${a.cu}`);
console.log(`  observed: WSOL ${spentA} raw (${Number(spentA) / 1e9} SOL)  devUSDC ${spentB} raw (${Number(spentB) / 1e6})`);

// Cross-check against Whirlpool math from the live sqrt_price.
const pool = (await conn.getAccountInfo(POOL)).data;
const sqrtPrice = pool.readBigUInt64LE(65) + (pool.readBigUInt64LE(73) << 64n);
const sc = Number(sqrtPrice) / 2 ** 64;
const sl = 1.0001 ** (LOWER / 2), sh = 1.0001 ** (UPPER / 2);
const Ln = Number(L);
console.log(`  predicted: WSOL ${Math.ceil((Ln * (sh - sc)) / (sc * sh))}  devUSDC ${Math.ceil(Ln * (sc - sl))}`);

console.log("=== full close (decrease + collect) ===");
const r = await sizeAndSend(
  program.methods.adapterRemoveLiquidity(LOWER, UPPER, L, new BN(0), new BN(0), true)
    .accounts(liqAccts)
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
);
console.log(`  tx bytes ${r.size} / 1232   unique accounts ${r.accounts}   CU ${r.cu}`);

console.log("=== close_position ===");
const c = await sizeAndSend(
  program.methods.adapterClosePosition().accounts({
    owner: kp.publicKey, market, marketAuthority: auth, permaPosition: permaPos,
    orcaPosition: orcaPos, positionMint: mint.publicKey, positionTokenAccount: posAta,
    tokenProgram: TOKEN_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
  })
);
console.log(`  tx bytes ${c.size} / 1232   unique accounts ${c.accounts}   CU ${c.cu}`);
