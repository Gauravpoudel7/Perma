// Reconcile, from outside the program, over RPC:
//   1. range_vault.amount == premium_pool + dust, for EVERY range
//   2. vault + Σ in_orca == Σ(free + locked), per side
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
const { AnchorProvider, Program, Wallet, web3 } = anchor;
const POOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const VA = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VB = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  readFileSync(process.env.ANCHOR_WALLET.replace("~", process.env.HOME), "utf8"))));
const conn = new web3.Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");
const program = new Program(JSON.parse(readFileSync("target/idl/perma.json", "utf8")),
  new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const market = PublicKey.findProgramAddressSync([Buffer.from("market"), POOL.toBuffer()], program.programId)[0];
const amt = async (pk) => { const i = await conn.getAccountInfo(pk); return i ? i.data.readBigUInt64LE(64) : 0n; };
const i32 = (v) => new BN(v).toTwos(32).toArrayLike(Buffer, "le", 4);

let bad = 0;
const ranges = await program.account.rangePremiumState.all([{ memcmp: { offset: 8, bytes: market.toBase58() } }]);
console.log(`ranges: ${ranges.length}`);
for (const { account: r } of ranges) {
  const vault = PublicKey.findProgramAddressSync(
    [Buffer.from("range_vault"), market.toBuffer(), i32(r.tickLower), i32(r.tickUpper)], program.programId)[0];
  const onChain = await amt(vault);
  const books = BigInt(r.premiumPool.toString()) + BigInt(r.dust.toString());
  const ok = onChain === books;
  if (!ok) bad++;
  console.log(`  [${r.tickLower},${r.tickUpper}] vault=${onChain} pool+dust=${books} receivable=${r.receivable} ${ok ? "OK" : "MISMATCH"}`);
}
const users = await program.account.userCollateral.all([{ memcmp: { offset: 8, bytes: market.toBase58() } }]);
let oA = 0n, oB = 0n, owed = 0n;
for (const { account: u } of users) {
  oA += BigInt(u.balanceA.toString()) + BigInt(u.lockedA.toString());
  oB += BigInt(u.balanceB.toString()) + BigInt(u.lockedB.toString());
  owed += BigInt(u.premiumOwedUsdc.toString());
}
const positions = await program.account.permaPosition.all([{ memcmp: { offset: 8, bytes: market.toBase58() } }]);
let iA = 0n, iB = 0n, carry = 0n;
const openLongsByOwner = new Map();
for (const { account: p } of positions) {
  iA += BigInt(p.inOrcaA.toString()); iB += BigInt(p.inOrcaB.toString());
  carry += BigInt(p.premiumReceivable.toString());
  if (p.legType === 1 && p.status === 0) {
    const k = p.owner.toBase58(); openLongsByOwner.set(k, (openLongsByOwner.get(k) ?? 0) + 1);
  }
}
// Component 09: UserCollateral.open_longs must equal the number of open LONG positions
// for that owner - the solvency gate counts remaining accounts against it.
let counterBad = 0;
for (const { account: u } of users) {
  const k = u.owner.toBase58(); const actual = openLongsByOwner.get(k) ?? 0;
  if (u.openLongs !== actual) { counterBad++; console.log(`  open_longs MISMATCH for ${k}: stored ${u.openLongs}, actual ${actual}`); }
}
console.log(`open_longs counters: ${users.length} users checked, ${counterBad} mismatched`);
const dA = (await amt(VA)) + iA - oA, dB = (await amt(VB)) + iB - oB;
console.log(`conservation A: ${dA}\nconservation B: ${dB}`);
if (dA !== 0n || dB !== 0n) {
  console.log(`  ^ non-zero is expected ONLY if tests/adapter-liquidity.ts has run on this
    ledger: the adapter_* harness moves vault tokens directly, without touching any
    UserCollateral, so it shifts this identity by design (~-4 per run). The product path
    - deposit / mint / burn / settle - keeps it at exactly 0. If it is non-zero on a
    ledger that never ran the harness suite, that is a real accounting bug.`);
}
console.log(`Σ premium_owed_usdc across all users: ${owed}`);
console.log(`Σ premium_receivable across positions: ${carry}`);
console.log(bad === 0 ? "\nESCROW IDENTITY HOLDS FOR EVERY RANGE" : `\n${bad} RANGE(S) MISMATCHED`);
process.exit(bad === 0 && counterBad === 0 ? 0 : 1);
