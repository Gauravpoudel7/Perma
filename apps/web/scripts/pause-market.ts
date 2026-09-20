/**
 * Component 10 admin console, as a script rather than a page: pause /
 * unpause the single Fair MVP market, or set the ADR-0003 risk parameters.
 * Signs with the GlobalConfig admin (`~/.config/solana/id.json` — the same
 * wallet that ran `create_market`).
 *
 *   yarn pause-market
 *   yarn unpause-market
 *   yarn set-risk-params <long_margin_horizon_slots> <long_margin_buffer_usdc>
 *
 * While paused: mint / deposit / lock are rejected; burn / settle / withdraw /
 * unlock still work (Exit Guaranteed). Pause and unpause are idempotent.
 */
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import idl from "../src/idl/perma.json" with { type: "json" };
import type { Perma } from "../src/idl/perma";
import { marketPda } from "../src/lib/pda";
import { fetchMarket } from "../src/lib/accounts";
import { WHIRLPOOL } from "../src/lib/constants";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");
const secret = Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8")));
const admin = Keypair.fromSecretKey(secret);
const provider = new AnchorProvider(
  connection,
  {
    publicKey: admin.publicKey,
    signTransaction: async (tx: any) => { tx.partialSign(admin); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach((t) => t.partialSign(admin)); return txs; },
  } as any,
  { commitment: "confirmed" }
);
const program = new Program<Perma>(idl as Perma, provider);

async function main() {
  const [action, arg1, arg2] = process.argv.slice(2);
  const [market] = marketPda(WHIRLPOOL);
  const show = async (label: string) => {
    const m = await fetchMarket(program, market);
    if (!m) throw new Error("Market account not found — seed the local validator first (README.md).");
    console.log(
      `${label}: isPaused=${m.isPaused} horizon=${m.longMarginHorizonSlots.toString()} buffer=${m.longMarginBufferUsdc.toString()}`
    );
  };
  console.log(`RPC: ${RPC_URL}\nAdmin: ${admin.publicKey.toBase58()}\nMarket: ${market.toBase58()}`);
  await show("before");

  const accounts = { admin: admin.publicKey, market };
  let sig: string;
  switch (action) {
    case "pause":
      sig = await program.methods.pauseMarket().accountsPartial(accounts).rpc();
      break;
    case "unpause":
      sig = await program.methods.unpauseMarket().accountsPartial(accounts).rpc();
      break;
    case "set-risk-params": {
      if (!arg1 || !arg2) throw new Error("usage: set-risk-params <horizon_slots> <buffer_usdc>");
      sig = await program.methods
        .setMarketRiskParams(new BN(arg1), new BN(arg2))
        .accountsPartial(accounts)
        .rpc();
      break;
    }
    default:
      throw new Error("usage: pause | unpause | set-risk-params <horizon> <buffer>");
  }
  console.log(`tx: ${sig}`);
  await show("after");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
