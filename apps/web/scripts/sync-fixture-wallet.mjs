#!/usr/bin/env node
/**
 * Point the web app at the localnet wallet the fixtures actually funded.
 *
 * `scripts/make-fixtures.mjs` forges WSOL + Orca devUSDC token accounts for
 * whoever `ANCHOR_WALLET` points at, because devUSDC has no local mint
 * authority and cannot be airdropped. Any other browser wallet therefore has
 * zero USDC on localnet. This script copies that public address (never a
 * secret) into `.env.local` so the UI can say so before a deposit fails.
 *
 * Usage: yarn sync-fixture-wallet
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(WEB, "..", "..", "tests", "fixtures", "addresses.json");
const ENV_FILE = join(WEB, ".env.local");
const KEY = "NEXT_PUBLIC_LOCALNET_FUNDED_WALLET";

if (!existsSync(FIXTURES)) {
  console.error(`No ${FIXTURES}. Run \`node scripts/make-fixtures.mjs\` from the repo root first.`);
  process.exit(1);
}

const { wallet } = JSON.parse(readFileSync(FIXTURES, "utf8"));
if (typeof wallet !== "string" || wallet.length < 32) {
  console.error(`addresses.json has no usable "wallet" field.`);
  process.exit(1);
}

const line = `${KEY}=${wallet}`;
let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (new RegExp(`^${KEY}=.*$`, "m").test(env)) {
  env = env.replace(new RegExp(`^${KEY}=.*$`, "m"), line);
} else {
  env = env.replace(/\n*$/, "\n") + `\n# Public address the localnet fixtures funded. Written by yarn sync-fixture-wallet.\n${line}\n`;
}
writeFileSync(ENV_FILE, env);

console.log(`Fixture-funded localnet wallet: ${wallet}`);
console.log(`Wrote ${KEY} to apps/web/.env.local. Restart \`yarn dev\` to pick it up.`);
console.log(`To fund a different address instead: ANCHOR_WALLET=<keypair.json> node scripts/make-fixtures.mjs, then restart the validator.`);
