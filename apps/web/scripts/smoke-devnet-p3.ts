/**
 * Solana-devnet P3 smoke for the operator's Mac. It does not upgrade the program.
 *
 *   yarn smoke-devnet-p3 -- --check
 *   yarn smoke-devnet-p3 -- --smoke
 *
 * --check reads the program length and runs the pool measure. No wallet, no txs.
 * --smoke refuses the pre-P3 ELF (594752), refuses a pool more than 200 bps from
 * Pyth, posts a Full Pyth update (or uses a sponsored account younger than 60s),
 * mints a small Short and Long near spot, closes the ephemeral Pyth accounts,
 * then Settle and Close. Settle/Close do not attach a price_update.
 *
 * Env: SOLANA_RPC or ANCHOR_PROVIDER_URL, ANCHOR_WALLET, PYTH_API_KEY (not committed).
 * Refuses any cluster whose genesis hash is not Solana-devnet's.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import idl from "../src/idl/perma.json" with { type: "json" };
import type { Perma } from "../src/idl/perma";
import type { PermaWallet } from "../src/lib/perma";

process.env.NEXT_PUBLIC_CLUSTER ??= "devnet";
process.env.NEXT_PUBLIC_RPC_URL ??=
  process.env.SOLANA_RPC ?? process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
process.env.NEXT_PUBLIC_PERMA_PROGRAM_ID ??= "4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt";
process.env.NEXT_PUBLIC_WHIRLPOOL ??= "2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G";
process.env.NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE ??= "1";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const smoke = process.argv.includes("--smoke");
const SHORT_LIQ = 100_000n;
const LONG_LIQ = 10_000n;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function measure(): boolean {
  const child = spawnSync(process.execPath, ["scripts/rebalance-devnet-pool.mjs", "--measure"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  process.stdout.write(child.stdout ?? "");
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0) fail("smoke: pool measure failed");
  return /WITHIN 200 bps/.test(child.stdout ?? "");
}

function isNothingToSettle(err: unknown): boolean {
  const text = String(err);
  return text.includes("Nothing to settle") || text.includes("NothingToSettle");
}

async function main() {
  const { Connection } = await import("@solana/web3.js");
  const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import(
    "@solana/spl-token"
  );
  const { AnchorProvider, Program } = await import("@coral-xyz/anchor");
  const { WHIRLPOOL } = await import("../src/lib/constants");
  const { marketPda, marketAuthorityPda } = await import("../src/lib/pda");
  const { fetchMarket, fetchOpenLongsForOwner } = await import("../src/lib/accounts");
  const { decodeWhirlpoolSpot } = await import("../src/lib/whirlpool");
  const { slippageCappedTokenMax } = await import("../src/lib/liquidityMath");
  const { buildMissingTickArrayIxs, checkTickArraysExist } = await import("../src/lib/tickArray");
  const { resolveMintShortOrcaAccounts } = await import("../src/lib/resolvePosition");
  const { buildBurnPositionIx, buildDepositCollateralIx, buildMintPositionIx, buildSettlePremiumIx } = await import(
    "../src/lib/perma"
  );
  const { PRE_P3_PROGRAM_DATA_LEN, readProgramElfLen, resolveMintPriceUpdate } = await import("../src/lib/pythUpdate");

  const url = process.env.NEXT_PUBLIC_RPC_URL ?? "";
  if (/mainnet/i.test(url)) fail(`smoke: refusing mainnet RPC ${url}`);
  const connection = new Connection(url, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) fail(`smoke: cluster genesis ${genesis} is not Solana-devnet`);

  console.log("Prototype. Not audited. Single pool. Not production mainnet risk capital.");
  const elf = await readProgramElfLen(connection, new PublicKey(process.env.NEXT_PUBLIC_PERMA_PROGRAM_ID ?? ""));
  console.log(`program elf  ${elf} bytes`);
  const preP3 = elf === PRE_P3_PROGRAM_DATA_LEN;
  console.log(preP3 ? "program      still pre-P3. Do not smoke. Run scripts/upgrade-devnet-p3.mjs --deploy on the Mac." : "program      ELF is not the pre-P3 length.");
  const within = measure();
  console.log(within ? "band         WITHIN 200 bps" : "band         OUTSIDE 200 bps");
  if (!smoke) {
    console.log("\n--check only. No transaction was sent. The live upgrade, if it happened, was not performed by this command.");
    process.exit(preP3 || !within ? 2 : 0);
  }
  if (preP3) fail("smoke: refusing --smoke while the program is still pre-P3");
  if (!within) fail("smoke: refusing --smoke while spot is outside 200 bps of Pyth");

  const walletPath = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, homedir());
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
  const wallet: PermaWallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as never, { commitment: "confirmed" });
  const program = new Program<Perma>(idl as Perma, provider);
  const [market] = marketPda(WHIRLPOOL);
  const marketAccount = await fetchMarket(program, market);
  if (!marketAccount) fail(`smoke: market ${market.toBase58()} is missing`);
  if (marketAccount.isPaused) fail("smoke: market is paused");

  const poolInfo = await connection.getAccountInfo(WHIRLPOOL);
  if (!poolInfo) fail("smoke: whirlpool account missing");
  const spot = decodeWhirlpoolSpot(poolInfo.data);
  const spacing = marketAccount.tickSpacing;
  const aligned = Math.floor(spot.tickCurrentIndex / spacing) * spacing;
  const tickLower = aligned - 8 * spacing;
  const tickUpper = aligned + 8 * spacing;
  console.log(`range        ticks ${tickLower} .. ${tickUpper} around spot tick ${spot.tickCurrentIndex}`);

  async function sendIxs(ixs: TransactionInstruction[], extra: Signer[], label: string) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = payer.publicKey;
    const latest = await connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, ...extra], { commitment: "confirmed" });
    console.log(`${label} ${sig}`);
    return sig;
  }

  const price = await resolveMintPriceUpdate({
    connection,
    payer: payer.publicKey,
    cluster: "devnet",
    flag: "1",
    sendTx: async (ixs, signers, successMessage) => {
      await sendIxs(ixs, signers, successMessage);
      return "ok";
    },
  });
  if (!price.ok || !price.priceUpdate) fail(price.error ?? "smoke: Pyth update was not posted");
  console.log(`price_update ${price.priceUpdate.toBase58()}`);

  const caps = slippageCappedTokenMax(SHORT_LIQ, spot.tickCurrentIndex, tickLower, tickUpper);
  const needA = caps.tokenMaxA + caps.tokenMaxA / 10n + 1n;
  const needB = caps.tokenMaxB + 1_000_000n;
  const ataA = getAssociatedTokenAddressSync(marketAccount.tokenMintA, payer.publicKey);
  const ataB = getAssociatedTokenAddressSync(marketAccount.tokenMintB, payer.publicKey);
  const bal = async (ata: PublicKey) =>
    BigInt((await connection.getTokenAccountBalance(ata).catch(() => ({ value: { amount: "0" } }))).value.amount);
  if ((await bal(ataA)) < needA || (await bal(ataB)) < needB) {
    fail(`smoke: wallet needs at least ${needA} raw WSOL and ${needB} raw devUSDC. Admin 7eDW… held both after the rebalance.`);
  }
  await sendIxs(
    [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataA, payer.publicKey, marketAccount.tokenMintA),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataB, payer.publicKey, marketAccount.tokenMintB),
      await buildDepositCollateralIx(program, {
        owner: payer.publicKey,
        market,
        userTokenA: ataA,
        userTokenB: ataB,
        vaultA: marketAccount.vaultA,
        vaultB: marketAccount.vaultB,
        amountA: needA,
        amountB: needB,
      }),
    ],
    [],
    "deposit"
  );

  const arrays = await checkTickArraysExist(connection, WHIRLPOOL, tickLower, tickUpper, spacing);
  if (!arrays.lowerExists || !arrays.upperExists) {
    await sendIxs(
      buildMissingTickArrayIxs(WHIRLPOOL, payer.publicKey, arrays, tickLower, tickUpper, spacing),
      [],
      "tick-array"
    );
  }

  const positionMint = Keypair.generate();
  const [marketAuthority] = marketAuthorityPda(market);
  const orca = resolveMintShortOrcaAccounts(marketAccount, marketAuthority, tickLower, tickUpper, positionMint.publicKey);
  const shortNonce = BigInt(Date.now());
  let shortOpen = false;
  let longNonce: bigint | null = null;
  try {
    await sendIxs(
      [
        await buildMintPositionIx(
          program,
          {
            leg: "short",
            owner: payer.publicKey,
            market,
            tickLower,
            tickUpper,
            liquidity: SHORT_LIQ,
            tokenMaxA: caps.tokenMaxA,
            tokenMaxB: caps.tokenMaxB,
            nonce: shortNonce,
            ...orca,
            positionMint,
          },
          { expectsPriceUpdate: true, priceUpdate: price.priceUpdate }
        ),
      ],
      [positionMint],
      "mint-short"
    );
    shortOpen = true;

    const opens = await fetchOpenLongsForOwner(program, connection, market, payer.publicKey);
    const mintedLong = shortNonce + 1n;
    await sendIxs(
      [
        await buildMintPositionIx(
          program,
          {
            leg: "long",
            owner: payer.publicKey,
            market,
            tickLower,
            tickUpper,
            liquidity: LONG_LIQ,
            nonce: mintedLong,
            whirlpool: WHIRLPOOL,
            existingOpenLongs: opens,
          },
          { expectsPriceUpdate: true, priceUpdate: price.priceUpdate }
        ),
      ],
      [],
      "mint-long"
    );
    longNonce = mintedLong;
  } finally {
    if (price.closeIxs.length > 0) {
      try {
        await sendIxs(price.closeIxs, [], "close-pyth");
        console.log("pyth         ephemeral accounts closed before settle/burn");
      } catch (err) {
        console.error("close-pyth failed", err);
      }
    }
    if (longNonce !== null) {
      try {
        await sendIxs(
          [
            await buildSettlePremiumIx(program, {
              cranker: payer.publicKey,
              owner: payer.publicKey,
              market,
              nonce: longNonce,
              tickLower,
              tickUpper,
              vaultB: marketAccount.vaultB,
            }),
          ],
          [],
          "settle-long"
        );
      } catch (err) {
        if (!isNothingToSettle(err)) console.error("settle-long failed", err);
        else console.log("settle-long  nothing owed yet. The instruction ran without a price_update account.");
      }
      try {
        await sendIxs(
          [
            await buildBurnPositionIx(program, {
              leg: "long",
              owner: payer.publicKey,
              market,
              nonce: longNonce,
              tickLower,
              tickUpper,
              vaultB: marketAccount.vaultB,
            }),
          ],
          [],
          "close-long"
        );
      } catch (err) {
        console.error("close-long failed", err);
      }
    }
    if (shortOpen) {
      await sendIxs(
        [
          await buildBurnPositionIx(program, {
            leg: "short",
            owner: payer.publicKey,
            market,
            nonce: shortNonce,
            tickLower,
            tickUpper,
            tokenMinA: 0n,
            tokenMinB: 0n,
            positionMint: positionMint.publicKey,
            ...orca,
          }),
        ],
        [],
        "close-short"
      );
    }
  }
  console.log("smoke        short and long opened with a Pyth account, then closed without one.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
