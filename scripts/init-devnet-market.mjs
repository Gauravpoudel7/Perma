// Deploy-time bootstrap for a cluster PERMA has never run on: create the two
// PERMA vaults, `initialize_global_config`, then `create_market`, in that
// order and only where the account is missing. Safe to re-run: every step is
// skipped when its account already exists, so a half-finished bootstrap can be
// resumed by running this again.
//
// The market's mints, vaults, tick spacing and premium parameters all come from
// the live Whirlpool account inside `create_market` — nothing here passes them
// in. The only fixed values are the allowlisted pool and the Whirlpool program,
// which are the same on every cluster.
//
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=~/.config/solana/id.json \
//   node scripts/init-devnet-market.mjs
import anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";

/** Host only: an RPC URL can carry an API key in its path or query. */
const rpcHost = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "<rpc>";
  }
};

const { AnchorProvider, Program, Wallet, web3 } = anchor;

/** The allowlisted pool: SOL/devUSDC, tick_spacing 8. Same id on localnet (cloned) and devnet. */
const POOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

// Whirlpool account offsets, verified against the live pool this session:
// token_mint_a at 101, token_mint_b at 181 (fee_growth_global_a sits between
// mint_a's vault and mint_b, so the two mints are NOT 64 bytes apart).
const WHIRLPOOL_MINT_A_OFFSET = 101;
const WHIRLPOOL_MINT_B_OFFSET = 181;

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Example:\n  ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json node scripts/init-devnet-market.mjs`);
    process.exit(1);
  }
  return v;
}

const url = req("ANCHOR_PROVIDER_URL");
const walletPath = req("ANCHOR_WALLET").replace(/^~/, process.env.HOME);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
const conn = new web3.Connection(url, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
const program = new Program(JSON.parse(readFileSync("target/idl/perma.json", "utf8")), provider);

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const globalConfig = pda([Buffer.from("global_config")]);
const market = pda([Buffer.from("market"), POOL.toBuffer()]);
const marketAuthority = pda([Buffer.from("market_authority"), market.toBuffer()]);

console.log(`cluster        ${rpcHost(url)}`);
console.log(`admin          ${kp.publicKey.toBase58()}`);
console.log(`program        ${program.programId.toBase58()}`);

if ((await conn.getAccountInfo(program.programId)) === null) {
  console.error(`\nThe program is not deployed on this cluster. Deploy it first:\n  anchor build --arch v0 && anchor deploy --provider.cluster devnet`);
  process.exit(1);
}

// Mints come from the pool itself, never from a constant: a wrong pair here
// would be recorded in the Market account and every later CPI would fail.
const poolInfo = await conn.getAccountInfo(POOL);
if (!poolInfo) {
  console.error(`\nWhirlpool ${POOL.toBase58()} does not exist on this cluster.`);
  process.exit(1);
}
const mintA = new PublicKey(poolInfo.data.subarray(WHIRLPOOL_MINT_A_OFFSET, WHIRLPOOL_MINT_A_OFFSET + 32));
const mintB = new PublicKey(poolInfo.data.subarray(WHIRLPOOL_MINT_B_OFFSET, WHIRLPOOL_MINT_B_OFFSET + 32));
console.log(`whirlpool      ${POOL.toBase58()}`);
console.log(`  token A      ${mintA.toBase58()}`);
console.log(`  token B      ${mintB.toBase58()}`);

// `create_market` requires both vaults to exist already, as token accounts for
// the pool's mints owned by the market_authority PDA (programs/perma/src/lib.rs).
const vaultA = getAssociatedTokenAddressSync(mintA, marketAuthority, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const vaultB = getAssociatedTokenAddressSync(mintB, marketAuthority, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

const missingVaults = [];
for (const [mint, vault, label] of [[mintA, vaultA, "A"], [mintB, vaultB, "B"]]) {
  if ((await conn.getAccountInfo(vault)) === null) {
    missingVaults.push(createAssociatedTokenAccountInstruction(kp.publicKey, vault, marketAuthority, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    console.log(`vault ${label}        ${vault.toBase58()}  (creating)`);
  } else {
    console.log(`vault ${label}        ${vault.toBase58()}  (exists)`);
  }
}
if (missingVaults.length > 0) {
  const tx = new web3.Transaction().add(...missingVaults);
  const sig = await provider.sendAndConfirm(tx, []);
  console.log(`  created vaults ${sig}`);
}

const existingConfig = await conn.getAccountInfo(globalConfig);
if (existingConfig === null) {
  const sig = await program.methods
    .initializeGlobalConfig(POOL)
    .accounts({ admin: kp.publicKey, globalConfig, systemProgram: SystemProgram.programId })
    .rpc();
  console.log(`global config  ${globalConfig.toBase58()}  (created ${sig})`);
} else {
  const cfg = await program.account.globalConfig.fetch(globalConfig);
  console.log(`global config  ${globalConfig.toBase58()}  (exists)`);
  if (!cfg.admin.equals(kp.publicKey)) {
    console.log(`  WARNING: admin is ${cfg.admin.toBase58()}, not this wallet. Admin instructions will fail for you.`);
  }
  if (!cfg.allowlistedWhirlpool.equals(POOL)) {
    console.log(`  WARNING: allowlisted pool is ${cfg.allowlistedWhirlpool.toBase58()}, not ${POOL.toBase58()}.`);
  }
}

if ((await conn.getAccountInfo(market)) === null) {
  const sig = await program.methods
    .createMarket()
    .accounts({
      admin: kp.publicKey,
      globalConfig,
      market,
      marketAuthority,
      whirlpool: POOL,
      vaultA,
      vaultB,
      whirlpoolProgram: WHIRLPOOL_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`market         ${market.toBase58()}  (created ${sig})`);
} else {
  console.log(`market         ${market.toBase58()}  (exists)`);
}

const m = await program.account.market.fetch(market);
console.log(`
--- summary (paste into RUNBOOK-DEVNET.md) ---
program            ${program.programId.toBase58()}
global config      ${globalConfig.toBase58()}
market             ${market.toBase58()}
market authority   ${marketAuthority.toBase58()}
whirlpool          ${m.whirlpool.toBase58()}
vault A            ${m.vaultA.toBase58()}
vault B            ${m.vaultB.toBase58()}
token mint A       ${m.tokenMintA.toBase58()}
token mint B       ${m.tokenMintB.toBase58()}
admin              ${kp.publicKey.toBase58()}
tick spacing       ${m.tickSpacing}
premium rate       ${m.premiumRate.toString()}
premium multiplier ${m.premiumMultiplier.toString()}
paused             ${m.isPaused}`);
