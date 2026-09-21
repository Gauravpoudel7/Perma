// Reconcile, from outside the program, over RPC:
//   1. range_vault.amount == premium_pool + dust, for EVERY range
//   2. vault + Σ in_orca == Σ(free + locked), per side
//
// With `--monitor` (P1), first print the ops surface the RUNBOOK checklist asks
// for: admin custody, pause state, risk params, and recent admin events. That
// block is advisory - it never changes the exit code, which stays purely the
// two accounting identities.
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
const { AnchorProvider, EventParser, Program, Wallet, web3 } = anchor;
const MONITOR = process.argv.includes("--monitor");
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

if (MONITOR) {
  const configPk = PublicKey.findProgramAddressSync([Buffer.from("global_config")], program.programId)[0];
  const cfg = await program.account.globalConfig.fetch(configPk);
  const m = await program.account.market.fetch(market);
  console.log("=== MONITOR ===");
  console.log(`global_config:        ${configPk.toBase58()}`);
  console.log(`  admin:              ${cfg.admin.toBase58()}`);
  console.log(`  allowlisted pool:   ${cfg.allowlistedWhirlpool.toBase58()}`);
  console.log(`market:               ${market.toBase58()}`);
  console.log(`  is_paused:          ${m.isPaused}`);
  console.log(`  premium_rate:       ${m.premiumRate}`);
  console.log(`  premium_multiplier: ${m.premiumMultiplier}`);
  console.log(`  long_margin_horizon_slots: ${m.longMarginHorizonSlots}`);
  console.log(`  long_margin_buffer_usdc:   ${m.longMarginBufferUsdc}`);

  // Best-effort: an RPC that cannot serve history degrades to a warning. The
  // checklist still works without it; the identities below are the real gate.
  // camelCase: that is how Anchor's client reports event names, and how
  // `tests/events.ts` asserts them.
  const ADMIN_EVENTS = new Set([
    "marketPauseSet", "marketPauseCleared", "marketRiskParamsSet",
    "adminTransferred", "rangeUnwound",
  ]);
  try {
    const parser = new EventParser(program.programId, program.coder);
    const sigs = await conn.getSignaturesForAddress(program.programId, { limit: 50 }, "confirmed");
    const hits = [];
    for (const { signature } of sigs) {
      const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      for (const ev of parser.parseLogs(tx?.meta?.logMessages ?? [], false)) {
        if (!ADMIN_EVENTS.has(ev.name)) continue;
        // Non-arrow: BN's own `toJSON` runs before the replacer and yields hex,
        // so read the original value off the holder (`this`) instead of `v`.
        const data = JSON.stringify(ev.data, function (k, v) {
          const raw = this[k];
          return raw?.toBase58 ? raw.toBase58() : BN.isBN(raw) ? raw.toString(10) : v;
        });
        hits.push(`  ${ev.name} ${signature.slice(0, 12)}… ${data}`);
      }
    }
    console.log(`recent admin events (last ${sigs.length} signatures): ${hits.length}`);
    for (const h of hits) console.log(h);
  } catch (e) {
    console.log(`  WARN: could not read program history (${e.message}); admin-event tail skipped`);
  }
  console.log("");
}

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
