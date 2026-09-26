/**
 * Exercises the app's REAL src/lib modules — PDA derivation, account
 * decoding, and solvency math — against genuine on-chain state on a running
 * local validator. Not a mock, not a duplicated re-implementation: imports
 * the exact same functions the React components call.
 *
 * Usage: yarn verify-live   (after seeding the local validator per README.md)
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "../src/idl/perma.json" with { type: "json" };
import type { Perma } from "../src/idl/perma";
import { marketPda, marketAuthorityPda, userCollateralPda } from "../src/lib/pda";
import { fetchMarket, fetchUserCollateral, fetchAllPositionsForOwner } from "../src/lib/accounts";
import { decodeWhirlpoolSpot, sqrtPriceX64ToPrice } from "../src/lib/whirlpool";
import { requiredFreeUsdc, projectedIndex } from "../src/lib/solvency";
import { WHIRLPOOL } from "../src/lib/constants";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");

const walletPath = `${homedir()}/.config/solana/id.json`;
const secret = Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")));
const keypair = Keypair.fromSecretKey(secret);

const wallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx: any) => tx,
  signAllTransactions: async (txs: any) => txs,
};
const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
const program = new Program<Perma>(idl as Perma, provider);

async function main() {
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);

  const [market] = marketPda(WHIRLPOOL);
  const [marketAuthority] = marketAuthorityPda(market);
  console.log(`\nMarket PDA:           ${market.toBase58()}`);
  console.log(`Market authority PDA: ${marketAuthority.toBase58()}`);

  const marketAccount = await fetchMarket(program, market);
  if (!marketAccount) {
    console.error("FAIL: Market account not found. Run the setup suites first (see README.md).");
    process.exit(1);
  }
  console.log(`\n[OK] Market decoded via lib/accounts.ts:`);
  console.log(`  whirlpool:        ${marketAccount.whirlpool.toBase58()}`);
  console.log(`  tickSpacing:      ${marketAccount.tickSpacing}`);
  console.log(`  isPaused:         ${marketAccount.isPaused}`);
  console.log(`  premiumRate:      ${marketAccount.premiumRate.toString()}`);
  console.log(`  longMarginHorizon:${marketAccount.longMarginHorizonSlots.toString()}`);

  const [ucPda] = userCollateralPda(market, keypair.publicKey);
  const uc = await fetchUserCollateral(program, ucPda);
  if (uc) {
    console.log(`\n[OK] UserCollateral decoded for ${keypair.publicKey.toBase58()}:`);
    console.log(`  balanceA (free WSOL):  ${uc.balanceA.toString()}`);
    console.log(`  balanceB (free USDC):  ${uc.balanceB.toString()}`);
    console.log(`  lockedA / lockedB:     ${uc.lockedA.toString()} / ${uc.lockedB.toString()}`);
    console.log(`  openLongs:             ${uc.openLongs}`);
  } else {
    console.log(`\n[--] No UserCollateral yet for this wallet (fine on a fresh ledger).`);
  }

  const positions = await fetchAllPositionsForOwner(program, connection, market, keypair.publicKey);
  console.log(`\n[OK] fetchAllPositionsForOwner (real getProgramAccounts + coder.accounts.decode): ${positions.length} position(s)`);
  for (const p of positions) {
    console.log(
      `  ${p.pubkey.toBase58().slice(0, 8)}... leg=${p.legType === 0 ? "SHORT" : "LONG"} status=${p.status} liquidity=${p.liquidity.toString()} ticks=[${p.tickLower},${p.tickUpper}]`
    );
  }

  const whirlpoolInfo = await connection.getAccountInfo(WHIRLPOOL);
  if (whirlpoolInfo) {
    const spot = decodeWhirlpoolSpot(whirlpoolInfo.data);
    const price = sqrtPriceX64ToPrice(spot.sqrtPriceX64, 9, 6);
    console.log(`\n[OK] Whirlpool spot decoded via lib/whirlpool.ts (raw bytes, no SDK):`);
    console.log(`  tickCurrentIndex: ${spot.tickCurrentIndex}`);
    console.log(`  price:            ${price.toFixed(4)} USDC/SOL (labeled "Spot" only)`);
  }

  if (uc) {
    const openLongs = positions.filter((p) => p.legType === 1 && p.status === 0);
    const required = requiredFreeUsdc(
      BigInt(uc.premiumOwedUsdc.toString()),
      openLongs.map((p) => ({
        accruedScaled: BigInt(p.accruedScaled.toString()),
        entryIndex: BigInt(p.entryIndex.toString()),
        liquidity: BigInt(p.liquidity.toString()),
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
      })),
      0n,
      {
        longMarginHorizonSlots: BigInt(marketAccount.longMarginHorizonSlots.toString()),
        premiumRate: BigInt(marketAccount.premiumRate.toString()),
        premiumMultiplier: BigInt(marketAccount.premiumMultiplier.toString()),
        longMarginBufferUsdc: BigInt(marketAccount.longMarginBufferUsdc.toString()),
      }
    );
    console.log(`\n[OK] lib/solvency.ts requiredFreeUsdc (the Vault tile's exact number): ${required.toString()} µUSDC`);
  }

  console.log("\nAll live reads succeeded against real on-chain accounts.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});

