// Solana-devnet only (ticket P3-DEVNET-POOL-PRICE): buy practice devUSDC for
// the admin/CLI wallet from Orca's devToken distributor, which is the same
// program the Nebula faucet UI and the Orca tutorial
// `convert_sol_to_dev_token.ts` call. Each `Distribute` pays a fixed 0.1 SOL to
// the distributor admin and credits a fixed 15 devUSDC (measured from live
// txs, e.g. 4nWRkLJB…; `--once` re-measures). It never touches the Whirlpool.
//
//   node scripts/fund-devusdc-faucet.mjs --once
//   node scripts/fund-devusdc-faucet.mjs --until 3600 [--per-tx 10]
//
// Env: SOLANA_RPC or ANCHOR_PROVIDER_URL (default public devnet), ANCHOR_WALLET
// (default ~/.config/solana/id.json; must be the PERMA admin). Refuses any
// cluster whose genesis hash is not Solana-devnet's, and never leaves the
// wallet under 1 SOL.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { readFileSync } from "fs";

/** Host only: an RPC URL can carry an API key in its path or query. */
const rpcHost = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "<rpc>";
  }
};

const DISTRIBUTOR = new PublicKey("Bu2AaWnVoveQT47wP4obpmmZUwK9bN9ah4w6Vaoa93Y9");
const DISTRIBUTOR_PDA = new PublicKey("3pgfe1L6jcq59uy3LZmmeSCk9mwVvHXjn21nSvNr8D6x");
const DEVTOKEN_ADMIN = new PublicKey("3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const ADMIN = new PublicKey("7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const DISTRIBUTE = Buffer.from("bf2cdfcfa4ec7e3d", "hex");
const SOL_PER_CALL = 0.1 * LAMPORTS_PER_SOL;
const RESERVE = 1 * LAMPORTS_PER_SOL;

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
};

const url = process.env.SOLANA_RPC ?? process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(url)) throw new Error(`faucet: refusing mainnet RPC ${rpcHost(url)}`);
const conn = new Connection(url, "confirmed");
const genesis = await conn.getGenesisHash();
if (genesis !== DEVNET_GENESIS) throw new Error(`faucet: cluster genesis ${genesis} is not Solana-devnet`);

const walletPath = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, process.env.HOME);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
if (!kp.publicKey.equals(ADMIN)) throw new Error(`faucet: wallet is ${kp.publicKey.toBase58()}, expected admin ${ADMIN.toBase58()}`);

const userAta = getAssociatedTokenAddressSync(DEV_USDC, kp.publicKey);
const vault = getAssociatedTokenAddressSync(DEV_USDC, DISTRIBUTOR_PDA, true);

// Account order and writability copied from live Distribute txs; the program
// creates the user ATA itself (CreateIdempotent in its logs).
const distributeIx = () =>
  new TransactionInstruction({
    programId: DISTRIBUTOR,
    keys: [
      { pubkey: DEV_USDC, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: DISTRIBUTOR_PDA, isSigner: false, isWritable: false },
      { pubkey: kp.publicKey, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: DEVTOKEN_ADMIN, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISTRIBUTE,
  });

/** Retries transport errors (429, fetch failures, expired blockhash); anything else is thrown. */
async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const transient = /429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|block height exceeded|Blockhash not found|BlockhashNotFound|timed out/i.test(String(e?.message ?? e));
      if (!transient || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const usdc = async () =>
  withRetry(async () => Number((await conn.getTokenAccountBalance(userAta).catch(() => ({ value: { amount: "0" } }))).value.amount) / 1e6);
const sol = async () => withRetry(() => conn.getBalance(kp.publicKey));

/** One tx with `calls` Distribute instructions. Simulates, sends, confirms, logs one JSON line. */
async function batch(calls) {
  const solBefore = await sol(), usdcBefore = await usdc();
  if (solBefore - calls * SOL_PER_CALL - 20_000 < RESERVE) throw new Error(`faucet: ${calls} call(s) would leave under 1 SOL (have ${solBefore / LAMPORTS_PER_SOL})`);
  const sig = await withRetry(async () => {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 * calls }));
    for (let i = 0; i < calls; i++) tx.add(distributeIx());
    tx.feePayer = kp.publicKey;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(kp);
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      console.error((sim.value.logs ?? []).slice(-6).join("\n"));
      throw new Error(`faucet: simulation failed ${JSON.stringify(sim.value.err)}`);
    }
    const s = await conn.sendRawTransaction(tx.serialize());
    const res = await conn.confirmTransaction({ signature: s, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`faucet: tx ${s} failed ${JSON.stringify(res.value.err)}`);
    return s;
  });
  const rec = { sig, calls, solBefore: solBefore / LAMPORTS_PER_SOL, solAfter: (await sol()) / LAMPORTS_PER_SOL, usdcBefore, usdcAfter: await usdc() };
  console.log(JSON.stringify(rec));
  return rec;
}

if (argv.includes("--once")) {
  await batch(1);
} else if (argv.includes("--until")) {
  const target = opt("--until", NaN), perTx = opt("--per-tx", 10);
  if (!(target > 0) || !(perTx >= 1)) throw new Error("faucet: --until needs a positive devUSDC target, --per-tx ≥ 1");
  let have = await usdc();
  while (have < target) {
    const r = await batch(Math.min(perTx, Math.ceil((target - have) / 15)));
    if (r.usdcAfter <= have) throw new Error("faucet: balance did not increase; stopping");
    have = r.usdcAfter;
  }
  console.log(`devUSDC ${have} ≥ ${target}`);
} else {
  console.log("usage: --once | --until <devUSDC> [--per-tx N]");
}
