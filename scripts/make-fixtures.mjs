#!/usr/bin/env node
/**
 * Generate funded USER token-account fixtures for the collateral + liquidity
 * suites.
 *
 * Orca devUSDC cannot be minted locally - we do not hold its mint authority.
 * Instead we hand-craft SPL token accounts at the exact ATA addresses the
 * program expects and inject them into solana-test-validator with `--account`.
 *
 * The devUSDC MINT is left untouched: we forge no mint authority and no
 * Whirlpool. Only the user's own ATAs are synthesised.
 *
 * ## Component 03 change
 *
 * These fixtures used to fund `Market.vault_a/vault_b` directly, which left the
 * vaults holding tokens that no `UserCollateral` accounted for - the
 * conservation invariant would fail the moment it was asserted. Now the USER's
 * ATAs are funded and the vaults start EMPTY; tokens enter through the real
 * `deposit_collateral` instruction. See IMPL-03-FEASIBILITY.md Q6.
 *
 * The owner is read from ANCHOR_WALLET (default ~/.config/solana/id.json), so
 * fixtures are per-machine - regenerate after switching wallets.
 *
 * Usage:  node scripts/make-fixtures.mjs
 * Output: tests/fixtures/user-a.json  (WSOL,    owner = test wallet)
 *         tests/fixtures/user-b.json  (devUSDC, owner = test wallet)
 *         tests/fixtures/addresses.json
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "tests", "fixtures");

const PERMA_PROGRAM = new PublicKey("4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt");
const WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Rent-exempt minimum for a 165-byte SPL token account. */
const TOKEN_ACCOUNT_RENT = 2_039_280;

// Sizing: L = 100_000_000 over [-40176, -38168] at tick -39140 needs about
// 0.0336 WSOL and 0.713 devUSDC. Fund ~300x that so slippage caps never bind.
const WSOL_AMOUNT = 10n * 1_000_000_000n; // 10 WSOL   (9 dp)
const USDC_AMOUNT = 1_000n * 1_000_000n; // 1000 devUSDC (6 dp)

/** Whoever runs the tests owns the funded ATAs. */
const walletPath = (process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`)
  .replace(/^~/, process.env.HOME);
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")))
).publicKey;

const [market] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), WHIRLPOOL.toBuffer()],
  PERMA_PROGRAM
);
const [marketAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("market_authority"), market.toBuffer()],
  PERMA_PROGRAM
);
const ata = (owner, mint) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  )[0];

// Funded: the user's own ATAs. The market vaults are derived only so the
// addresses file can report them - they are intentionally NOT funded.
const userA = ata(wallet, WSOL);
const userB = ata(wallet, DEV_USDC);
const vaultA = ata(marketAuthority, WSOL);
const vaultB = ata(marketAuthority, DEV_USDC);

/**
 * SPL token account, 165 bytes:
 *   mint[32] owner[32] amount[8] delegate(COption)[36]
 *   state[1] is_native(COption)[12] delegated_amount[8] close_authority[36]
 */
function tokenAccount(mint, owner, amount, isNative) {
  const d = Buffer.alloc(165);
  mint.toBuffer().copy(d, 0);
  owner.toBuffer().copy(d, 32);
  d.writeBigUInt64LE(BigInt(amount), 64);
  d.writeUInt32LE(0, 72); // delegate = None
  d[108] = 1; // AccountState::Initialized
  if (isNative) {
    d.writeUInt32LE(1, 109); // is_native = Some(rent_exempt_reserve)
    d.writeBigUInt64LE(BigInt(TOKEN_ACCOUNT_RENT), 113);
  } else {
    d.writeUInt32LE(0, 109); // is_native = None
  }
  d.writeBigUInt64LE(0n, 121); // delegated_amount
  d.writeUInt32LE(0, 129); // close_authority = None
  return d;
}

function dump(pubkey, data, lamports) {
  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports,
      data: [data.toString("base64"), "base64"],
      owner: TOKEN_PROGRAM.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
}

mkdirSync(OUT, { recursive: true });

// A native (WSOL) account's lamports must cover rent PLUS the wrapped amount.
writeFileSync(
  join(OUT, "user-a.json"),
  JSON.stringify(
    dump(userA, tokenAccount(WSOL, wallet, WSOL_AMOUNT, true), TOKEN_ACCOUNT_RENT + Number(WSOL_AMOUNT)),
    null,
    2
  )
);
writeFileSync(
  join(OUT, "user-b.json"),
  JSON.stringify(
    dump(userB, tokenAccount(DEV_USDC, wallet, USDC_AMOUNT, false), TOKEN_ACCOUNT_RENT),
    null,
    2
  )
);

// The vaults must EXIST for create_market to validate their mint and owner,
// but they start at zero - deposit_collateral is what funds them. Emitting
// them at amount 0 keeps the whole setup deterministic and fixture-driven.
writeFileSync(
  join(OUT, "vault-a.json"),
  JSON.stringify(
    dump(vaultA, tokenAccount(WSOL, marketAuthority, 0n, true), TOKEN_ACCOUNT_RENT),
    null,
    2
  )
);
writeFileSync(
  join(OUT, "vault-b.json"),
  JSON.stringify(
    dump(vaultB, tokenAccount(DEV_USDC, marketAuthority, 0n, false), TOKEN_ACCOUNT_RENT),
    null,
    2
  )
);

const addresses = {
  permaProgram: PERMA_PROGRAM.toBase58(),
  whirlpool: WHIRLPOOL.toBase58(),
  market: market.toBase58(),
  marketAuthority: marketAuthority.toBase58(),
  wallet: wallet.toBase58(),
  userA: userA.toBase58(),
  userB: userB.toBase58(),
  // Emitted EMPTY (amount 0); deposit_collateral fills them.
  vaultA: vaultA.toBase58(),
  vaultB: vaultB.toBase58(),
  wsolAmount: WSOL_AMOUNT.toString(),
  usdcAmount: USDC_AMOUNT.toString(),
};
writeFileSync(join(OUT, "addresses.json"), JSON.stringify(addresses, null, 2));

console.log("fixtures written to tests/fixtures/");
for (const [k, v] of Object.entries(addresses)) console.log(`  ${k.padEnd(16)} ${v}`);
console.log("\nvalidator flags:");
console.log(`  --account ${userA.toBase58()} tests/fixtures/user-a.json \\`);
console.log(`  --account ${userB.toBase58()} tests/fixtures/user-b.json \\`);
console.log(`  --account ${vaultA.toBase58()} tests/fixtures/vault-a.json \\`);
console.log(`  --account ${vaultB.toBase58()} tests/fixtures/vault-b.json`);
console.log("\nVaults are emitted EMPTY - deposit_collateral funds them.");
