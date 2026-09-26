// Solana-devnet P3 upgrade helper. This file does not upgrade anything unless
// the operator passes --deploy, and even then it refuses every cluster except
// Solana-devnet and every wallet except the current upgrade authority.
//
//   node scripts/upgrade-devnet-p3.mjs                 # read-only check + the Mac commands
//   node scripts/upgrade-devnet-p3.mjs --deploy        # operator's Mac, admin key in ANCHOR_WALLET
//
// Live program at authoring time: 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt
// data length 594752 (pre-P3), slot 502540621, authority
// 7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY. A local P3 build is ~604872 B.
// Do not treat a green --check as an upgrade. See
// docs/audits/IMPL-P3-DEVNET-UPGRADE.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

/** Host only: an RPC URL can carry an API key in its path or query. */
const rpcHost = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "<rpc>";
  }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROGRAM_ID = new PublicKey("4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PRE_P3_ELF = 594_752;
const HEADER = 45;
const SO_PATH = join(ROOT, "target/deploy/perma.so");
const KEYPAIR_PATH = join(ROOT, "target/deploy/perma-keypair.json");

const argv = process.argv.slice(2);
const deploy = argv.includes("--deploy");
const url = process.env.SOLANA_RPC ?? process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
const walletPath = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, homedir());

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (/mainnet/i.test(url)) fail(`upgrade-devnet-p3: refusing mainnet RPC ${rpcHost(url)}`);

const conn = new Connection(url, "confirmed");
const genesis = await conn.getGenesisHash();
if (genesis !== DEVNET_GENESIS) fail(`upgrade-devnet-p3: cluster genesis ${genesis} is not Solana-devnet`);

function readElf(programAccount) {
  if (programAccount.readUInt32LE(0) !== 2) fail("upgrade-devnet-p3: program account is not upgradeable");
  return new PublicKey(programAccount.subarray(4, 36));
}

const programInfo = await conn.getAccountInfo(PROGRAM_ID);
if (!programInfo) fail(`upgrade-devnet-p3: ${PROGRAM_ID.toBase58()} is not deployed`);
const dataPk = readElf(Buffer.from(programInfo.data));
const dataInfo = await conn.getAccountInfo(dataPk);
if (!dataInfo) fail(`upgrade-devnet-p3: program data ${dataPk.toBase58()} is missing`);
const data = Buffer.from(dataInfo.data);
if (data.readUInt32LE(0) !== 3 || data[12] !== 1) fail("upgrade-devnet-p3: program data header is not the expected upgradeable layout");
const slot = data.readBigUInt64LE(4);
const authority = new PublicKey(data.subarray(13, 45));
const elfLen = data.length - HEADER;

const soBytes = existsSync(SO_PATH) ? statSync(SO_PATH).size : null;
console.log("Prototype. Not audited. Single pool. Not production mainnet risk capital.");
console.log(`cluster      ${rpcHost(url)}`);
console.log(`program      ${PROGRAM_ID.toBase58()}`);
console.log(`  data       ${dataPk.toBase58()}`);
console.log(`  elf        ${elfLen} bytes`);
console.log(`  slot       ${slot}`);
console.log(`  authority  ${authority.toBase58()}`);
console.log(`  pre-P3     ${elfLen === PRE_P3_ELF ? "YES — still the pre-P3 build. No upgrade has landed." : "no (length is not 594752)"}`);
console.log(`  local .so  ${soBytes === null ? "missing — on the Mac: anchor build --arch v0" : `${SO_PATH} (${soBytes} bytes)`}`);
if (soBytes !== null) {
  console.log(`  matches    ${soBytes === elfLen ? "on-chain ELF matches the local file" : "on-chain ELF does not match the local file"}`);
}

console.log("\nmeasure      node scripts/rebalance-devnet-pool.mjs --measure");
const measure = spawnSync(process.execPath, ["scripts/rebalance-devnet-pool.mjs", "--measure"], {
  cwd: ROOT,
  encoding: "utf8",
  env: process.env,
});
process.stdout.write(measure.stdout ?? "");
if (measure.stderr) process.stderr.write(measure.stderr);
if (measure.status !== 0) fail("upgrade-devnet-p3: pool measure failed. Do not deploy.");
const within = /WITHIN 200 bps/.test(measure.stdout ?? "");
console.log(within ? "band         WITHIN 200 bps" : "band         OUTSIDE 200 bps — rebalance before any deploy");

const deployCmd = [
  "solana program deploy target/deploy/perma.so",
  `--program-id ${KEYPAIR_PATH}`,
  `--upgrade-authority ${walletPath}`,
  `-u "$SOLANA_RPC"`,
].join(" \\\n  ");
console.log("\nMac deploy (only after measure is WITHIN 200 bps and anchor build --arch v0):");
console.log(deployCmd);
console.log("\nThis process did not send an upgrade. Pass --deploy on the operator Mac to send one.");

if (!deploy) process.exit(within ? 0 : 2);
if (!within) fail("upgrade-devnet-p3: refusing --deploy while spot is outside 200 bps of Pyth");
if (soBytes === null) fail("upgrade-devnet-p3: refusing --deploy without target/deploy/perma.so");
if (!existsSync(KEYPAIR_PATH)) fail(`upgrade-devnet-p3: missing ${KEYPAIR_PATH}`);
if (!existsSync(walletPath)) fail(`upgrade-devnet-p3: missing wallet ${walletPath}`);
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
if (!wallet.publicKey.equals(authority)) {
  fail(
    `upgrade-devnet-p3: wallet ${wallet.publicKey.toBase58()} is not the upgrade authority ${authority.toBase58()}`
  );
}
if (soBytes === elfLen) {
  console.log("upgrade-devnet-p3: local .so is the same size as the live ELF. Deploy anyway only if you meant to replace it.");
}

console.log("upgrade-devnet-p3: deploying…");
const child = spawnSync(
  "solana",
  [
    "program",
    "deploy",
    SO_PATH,
    "--program-id",
    KEYPAIR_PATH,
    "--upgrade-authority",
    walletPath,
    "-u",
    url,
  ],
  { cwd: ROOT, stdio: "inherit", env: process.env }
);
if (child.error) fail(`upgrade-devnet-p3: could not run solana (${child.error.message}). Run the command above.`);
if (child.status !== 0) fail(`upgrade-devnet-p3: solana program deploy exited ${child.status}`);
console.log("upgrade-devnet-p3: deploy process exited 0. Re-run without --deploy and confirm elf is no longer 594752.");
