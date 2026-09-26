// Solana-devnet only (ticket P3-DEVNET-POOL-PRICE, Option A): move the
// allowlisted Whirlpool's spot toward live Pyth SOL/USD by swapping on it, one
// explicit step at a time, so P3's 2% deviation gate (MAX_DEVIATION_BPS = 200,
// programs/perma/src/oracle.rs) can pass after the P3 upgrade. It never touches
// PERMA, the band, or the localnet mock receiver.
//
//   node scripts/rebalance-devnet-pool.mjs --measure
//   node scripts/rebalance-devnet-pool.mjs --plan [--target-deviation-bps 200]
//   node scripts/rebalance-devnet-pool.mjs --step 500 [--dry-run]
//   node scripts/rebalance-devnet-pool.mjs --until-within-bps 200 [--max-step 500] [--max-steps 12]
//
// `--step` amounts are in the input token: devUSDC while spot is below Pyth
// (buys WSOL, raises spot), WSOL while spot is above Pyth. Each step's
// sqrt_price_limit is Pyth itself, so a step can never overshoot it.
//
// Env: SOLANA_RPC or ANCHOR_PROVIDER_URL (default public devnet), ANCHOR_WALLET
// (default ~/.config/solana/id.json), PYTH_PRICE_ACCOUNT (default: Pyth's
// sponsored SOL/USD push feed, shard 0). Refuses any cluster whose genesis hash
// is not Solana-devnet's.
//
// Pyth is read from its on-chain PriceUpdateV2 account, not Hermes: public
// Hermes answered 401 from the ops Mac (IMPL-P3-DEVNET-POOL-PRICE-FEASIBILITY.md).
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { readFileSync } from "fs";

/** Host only: an RPC URL can carry an API key in its path or query. */
const rpcHost = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "<rpc>";
  }
};

const POOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
// ADR-0004 feed id. The sponsored account is the push-oracle PDA [shard u16 LE = 0, feed_id].
const FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const PYTH_ACCOUNT = new PublicKey(
  process.env.PYTH_PRICE_ACCOUNT ?? PublicKey.findProgramAddressSync([Buffer.from([0, 0]), FEED], PYTH_PUSH_ORACLE)[0]
);

const DECIMALS_A = 9, DECIMALS_B = 6, TICK_SPACING = 8, TICK_ARRAY_SIZE = 88;
const ARRAY_SPAN = TICK_SPACING * TICK_ARRAY_SIZE; // 704 ticks

// ---- args / cluster -------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
};

const url = process.env.SOLANA_RPC ?? process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(url)) throw new Error(`rebalance: refusing mainnet RPC ${rpcHost(url)}`);
const conn = new Connection(url, "confirmed");
const genesis = await conn.getGenesisHash();
if (genesis !== DEVNET_GENESIS) throw new Error(`rebalance: cluster genesis ${genesis} is not Solana-devnet`);

const wallet = () => {
  const path = (process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json").replace(/^~/, process.env.HOME);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
};

// ---- reads ----------------------------------------------------------------

const sqrtAt = (tick) => Math.pow(1.0001, tick / 2);
const tickOf = (sqrt) => Math.floor(Math.log(sqrt * sqrt) / Math.log(1.0001));
const spotOf = (sqrt) => sqrt * sqrt * 10 ** (DECIMALS_A - DECIMALS_B);
const sqrtOfSpot = (spot) => Math.sqrt(spot / 10 ** (DECIMALS_A - DECIMALS_B));
const bpsOff = (spot, pyth) => (Math.abs(spot - pyth) * 10_000) / pyth;
const arrayStart = (tick) => Math.floor(tick / ARRAY_SPAN) * ARRAY_SPAN;
const tickArrayPda = (start) =>
  PublicKey.findProgramAddressSync([Buffer.from("tick_array"), POOL.toBuffer(), Buffer.from(start.toString())], WHIRLPOOL_PROGRAM)[0];
const u128 = (d, o) => d.readBigUInt64LE(o) | (d.readBigUInt64LE(o + 8) << 64n);
const i128 = (d, o) => d.readBigUInt64LE(o) | (d.readBigInt64LE(o + 8) << 64n);

// Offsets as in apps/web/src/lib/whirlpool.ts (liquidity/sqrt_price/tick) and
// scripts/init-devnet-market.mjs (mints/vaults), from orca_whirlpools_client 8.0.0.
async function readPool() {
  const d = (await conn.getAccountInfo(POOL)).data;
  const pool = {
    feeRate: d.readUInt16LE(45),
    liquidity: u128(d, 49),
    sqrtX64: u128(d, 65),
    tick: d.readInt32LE(81),
    vaultA: new PublicKey(d.subarray(133, 165)),
    vaultB: new PublicKey(d.subarray(213, 245)),
  };
  if (!new PublicKey(d.subarray(101, 133)).equals(WSOL) || !new PublicKey(d.subarray(181, 213)).equals(DEV_USDC)) {
    throw new Error("rebalance: pool mints are not WSOL/devUSDC");
  }
  pool.sqrt = Number(pool.sqrtX64) / 2 ** 64;
  pool.spot = spotOf(pool.sqrt);
  return pool;
}

// PriceUpdateV2 (pyth-solana-receiver): disc 8, write_authority 32,
// verification_level (Partial = tag 0 + u8, Full = tag 1), then feed_id 32,
// price i64, conf u64, exponent i32, publish_time i64.
async function readPyth() {
  const info = await conn.getAccountInfo(PYTH_ACCOUNT);
  if (!info || !info.owner.equals(PYTH_RECEIVER)) throw new Error(`rebalance: ${PYTH_ACCOUNT.toBase58()} is not a Pyth receiver account`);
  const d = info.data;
  if (d[40] !== 1) throw new Error("rebalance: Pyth update is not VerificationLevel::Full");
  if (!d.subarray(41, 73).equals(FEED)) throw new Error("rebalance: Pyth account is not the ADR-0004 SOL/USD feed");
  const expo = d.readInt32LE(89);
  const publishTime = Number(d.readBigInt64LE(93));
  return {
    price: Number(d.readBigInt64LE(73)) * 10 ** expo,
    conf: Number(d.readBigUInt64LE(81)) * 10 ** expo,
    publishTime,
    ageSecs: Math.floor(Date.now() / 1000) - publishTime,
  };
}

/** Initialized ticks of the pool as sorted [tickIndex, liquidityNet], plus the set of existing tick-array starts. */
async function readTicks() {
  const fixed = await conn.getProgramAccounts(WHIRLPOOL_PROGRAM, {
    filters: [{ dataSize: 9988 }, { memcmp: { offset: 9956, bytes: POOL.toBase58() } }],
  });
  const dynamic = await conn.getProgramAccounts(WHIRLPOOL_PROGRAM, {
    filters: [{ memcmp: { offset: 12, bytes: POOL.toBase58() } }],
  });
  const ticks = [], starts = new Set();
  // FixedTickArray: disc 8, start i32, 88 × Tick(113 B: initialized bool, liquidity_net i128, ...).
  for (const { account: { data: d } } of fixed) {
    const start = d.readInt32LE(8);
    starts.add(start);
    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
      const o = 12 + i * 113;
      if (d[o]) ticks.push([start + i * TICK_SPACING, i128(d, o + 1)]);
    }
  }
  // DynamicTickArray: disc 8, start i32, whirlpool 32, bitmap u128, then per tick
  // a tag byte (0 = Uninitialized, 1 = Initialized + 112 B with liquidity_net first).
  for (const { account: { data: d } } of dynamic) {
    const start = d.readInt32LE(8);
    starts.add(start);
    let o = 60;
    for (let i = 0; i < TICK_ARRAY_SIZE; i++) {
      if (d[o++] === 1) {
        ticks.push([start + i * TICK_SPACING, i128(d, o)]);
        o += 112;
      }
    }
  }
  ticks.sort((a, b) => a[0] - b[0]);
  return { ticks, starts };
}

// ---- swap math (float; planning and slippage floor only, on-chain is exact) ---

/**
 * Walks the pool from `state` toward `limitSqrt`, crossing initialized ticks,
 * spending at most `budgetIn` raw input (fee-inclusive). `up` = devUSDC in,
 * price rises. Returns gross input used, raw output, and the end state.
 */
function walk(state, ticks, up, limitSqrt, budgetIn = Infinity) {
  const keep = 1 - state.feeRate / 1e6;
  const netBudget = budgetIn * keep;
  let s = state.sqrt, L = Number(state.liquidity), inNet = 0, out = 0;
  const path = up ? ticks.filter(([t]) => t > state.tick) : ticks.filter(([t]) => t <= state.tick).reverse();
  for (const [t, net] of [...path, [up ? Infinity : -Infinity, 0n]]) {
    const target = up ? Math.min(sqrtAt(t), limitSqrt) : Math.max(sqrtAt(t), limitSqrt);
    const need = up ? L * (target - s) : L * (1 / target - 1 / s);
    if (inNet + need >= netBudget) {
      const rem = netBudget - inNet;
      const s1 = up ? s + rem / L : 1 / (1 / s + rem / L);
      out += up ? L * (1 / s - 1 / s1) : L * (s - s1);
      return { inGross: budgetIn, out, sqrt: s1, liquidity: L };
    }
    inNet += need;
    out += up ? L * (1 / s - 1 / target) : L * (s - target);
    s = target;
    if (target === limitSqrt) break;
    L += Number(up ? net : -net);
  }
  return { inGross: inNet / keep, out, sqrt: s, liquidity: L };
}

/**
 * One `swap` spans three tick arrays. Up: the array holding tick+spacing (Orca's
 * shifted start for b→a) and the next two; the step stops one spacing short of
 * the third array's end. Down: the current array and the previous two.
 */
function stepWindow(tick, up, pythSqrt) {
  const s0 = arrayStart(up ? tick + TICK_SPACING : tick);
  const starts = up ? [s0, s0 + ARRAY_SPAN, s0 + 2 * ARRAY_SPAN] : [s0, s0 - ARRAY_SPAN, s0 - 2 * ARRAY_SPAN];
  const edge = up ? sqrtAt(s0 + 3 * ARRAY_SPAN - TICK_SPACING) : sqrtAt(s0 - 2 * ARRAY_SPAN + TICK_SPACING);
  return { starts, limitSqrt: up ? Math.min(edge, pythSqrt) : Math.max(edge, pythSqrt) };
}

// ---- modes ----------------------------------------------------------------

async function measure(quiet = false) {
  const pool = await readPool();
  const pyth = await readPyth();
  const bps = bpsOff(pool.spot, pyth.price);
  // Self-check: the sqrt_price decode and tick_current_index must agree.
  if (Math.abs(tickOf(pool.sqrt) - pool.tick) > 1) {
    throw new Error(`rebalance: decode mismatch, sqrt_price implies tick ${tickOf(pool.sqrt)} but pool says ${pool.tick}`);
  }
  if (!quiet) {
    console.log(`cluster      ${rpcHost(url)}`);
    console.log(`pool         ${POOL.toBase58()}`);
    console.log(`  tick       ${pool.tick}`);
    console.log(`  sqrt_price ${pool.sqrtX64}`);
    console.log(`  liquidity  ${pool.liquidity}`);
    console.log(`  Spot       ${pool.spot.toFixed(4)} USDC/SOL`);
    console.log(`pyth         ${PYTH_ACCOUNT.toBase58()}`);
    console.log(`  SOL/USD    ${pyth.price.toFixed(4)}  conf ${pyth.conf.toFixed(4)}  publish ${pyth.publishTime}  age ${pyth.ageSecs}s`);
    console.log(`deviation    ${bps.toFixed(1)} bps  (${bps <= 200 ? "WITHIN" : "OUTSIDE"} 200 bps, devUSDC = USD 1:1)`);
  }
  return { pool, pyth, bps };
}

async function plan(targetBps) {
  const { pool, pyth, bps } = await measure();
  const { ticks, starts } = await readTicks();
  const up = pool.spot < pyth.price;
  const pythSqrt = sqrtOfSpot(pyth.price);
  const edgeSpot = pyth.price * (up ? 1 - targetBps / 10_000 : 1 + targetBps / 10_000);
  const [inSym, outSym, inDec, outDec] = up ? ["devUSDC", "WSOL", DECIMALS_B, DECIMALS_A] : ["WSOL", "devUSDC", DECIMALS_A, DECIMALS_B];
  const toEdge = walk(pool, ticks, up, sqrtOfSpot(edgeSpot));
  const toPyth = walk(pool, ticks, up, pythSqrt);
  console.log(`\ndirection    ${inSym} → ${outSym} (${up ? "raise" : "lower"} spot), band edge ${edgeSpot.toFixed(4)} = tick ~${tickOf(sqrtOfSpot(edgeSpot))}`);
  console.log(`to band edge ${(toEdge.inGross / 10 ** inDec).toFixed(3)} ${inSym} in, ${(toEdge.out / 10 ** outDec).toFixed(3)} ${outSym} out`);
  console.log(`to Pyth      ${(toPyth.inGross / 10 ** inDec).toFixed(3)} ${inSym} in, ${(toPyth.out / 10 ** outDec).toFixed(3)} ${outSym} out`);
  if (bps <= targetBps) return console.log("\nalready within target; no steps needed");

  console.log(`\nsteps (each one swap, limit = min(third tick array edge, Pyth)):`);
  let state = pool, n = 0;
  const missing = new Set();
  while (state.sqrt !== pythSqrt && n < 40) {
    const w = stepWindow(state.tick, up, pythSqrt);
    w.starts.filter((s) => !starts.has(s)).forEach((s) => missing.add(s));
    const r = walk(state, ticks, up, w.limitSqrt);
    state = { ...state, sqrt: r.sqrt, liquidity: BigInt(Math.round(r.liquidity)), tick: tickOf(r.sqrt) };
    const spot = spotOf(state.sqrt);
    console.log(
      `  #${String(++n).padStart(2)}  arrays ${w.starts.join(",").padEnd(22)} in ${(r.inGross / 10 ** inDec).toFixed(3).padStart(10)} ${inSym}` +
        `  out ${(r.out / 10 ** outDec).toFixed(3).padStart(9)}  spot ${spot.toFixed(3).padStart(8)}  ${bpsOff(spot, pyth.price).toFixed(0).padStart(5)} bps`
    );
  }
  if (missing.size) console.log(`\nuninitialized tick arrays on path: ${[...missing].sort((a, b) => a - b).join(", ")}`);
}

/** One swap. `amount` is human units of the input token. Returns the JSON log record. */
async function step(amount, dryRun) {
  const kp = wallet();
  const before = await measure(true);
  const { pool, pyth } = before;
  const up = pool.spot < pyth.price;
  const [inMint, inDec, outDec] = up ? [DEV_USDC, DECIMALS_B, DECIMALS_A] : [WSOL, DECIMALS_A, DECIMALS_B];
  const ataA = getAssociatedTokenAddressSync(WSOL, kp.publicKey);
  const ataB = getAssociatedTokenAddressSync(DEV_USDC, kp.publicKey);
  const bal = async (ata) => BigInt((await conn.getTokenAccountBalance(ata).catch(() => ({ value: { amount: "0" } }))).value.amount);

  const { ticks } = await readTicks();
  const w = stepWindow(pool.tick, up, sqrtOfSpot(pyth.price));
  const q = walk(pool, ticks, up, w.limitSqrt, amount * 10 ** inDec);
  // Never send more than reaching the limit needs; the price limit stops the swap there anyway.
  const amountRaw = BigInt(Math.ceil(Math.min(amount * 10 ** inDec, q.inGross)));
  const minOut = BigInt(Math.floor(q.out * 0.99));
  const limitX64 = BigInt(Math.floor(w.limitSqrt * 2 ** 64));

  // Orca `swap` (v1; both mints are SPL Token). Discriminator, arg order and
  // account metas from orca_whirlpools_client 8.0.0 generated/instructions/swap.rs.
  const data = Buffer.alloc(8 + 8 + 8 + 16 + 1 + 1);
  Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]).copy(data, 0);
  data.writeBigUInt64LE(amountRaw, 8);
  data.writeBigUInt64LE(minOut, 16); // other_amount_threshold: min out for exact input
  data.writeBigUInt64LE(limitX64 & ((1n << 64n) - 1n), 24);
  data.writeBigUInt64LE(limitX64 >> 64n, 32);
  data.writeUInt8(1, 40); // amount_specified_is_input
  data.writeUInt8(up ? 0 : 1, 41); // a_to_b: WSOL in lowers spot
  const [ta0, ta1, ta2] = w.starts.map(tickArrayPda);
  const oracle = PublicKey.findProgramAddressSync([Buffer.from("oracle"), POOL.toBuffer()], WHIRLPOOL_PROGRAM)[0];
  const swapIx = new TransactionInstruction({
    programId: WHIRLPOOL_PROGRAM,
    keys: [
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: kp.publicKey, isSigner: true, isWritable: false },
      { pubkey: POOL, isSigner: false, isWritable: true },
      { pubkey: ataA, isSigner: false, isWritable: true },
      { pubkey: pool.vaultA, isSigner: false, isWritable: true },
      { pubkey: ataB, isSigner: false, isWritable: true },
      { pubkey: pool.vaultB, isSigner: false, isWritable: true },
      { pubkey: ta0, isSigner: false, isWritable: true },
      { pubkey: ta1, isSigner: false, isWritable: true },
      { pubkey: ta2, isSigner: false, isWritable: true },
      { pubkey: oracle, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ataA, kp.publicKey, WSOL),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ataB, kp.publicKey, DEV_USDC),
    swapIx
  );

  console.log(`step         ${Number(amountRaw) / 10 ** inDec} ${inMint.equals(DEV_USDC) ? "devUSDC" : "WSOL"} in, quote out ${(q.out / 10 ** outDec).toFixed(6)}, min ${Number(minOut) / 10 ** outDec}`);
  console.log(`  arrays     ${w.starts.join(", ")}   limit spot ${spotOf(w.limitSqrt).toFixed(4)}`);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    console.log((sim.value.logs ?? []).slice(-8).join("\n"));
    throw new Error(`rebalance: simulation failed ${JSON.stringify(sim.value.err)}`);
  }
  console.log(`  simulation ok, ${sim.value.unitsConsumed} CU`);
  if (dryRun) return null;

  const [a0, b0] = [await bal(ataA), await bal(ataB)];
  const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  const [a1, b1] = [await bal(ataA), await bal(ataB)];
  const after = await measure(true);
  const rec = {
    ts: new Date().toISOString(),
    sig,
    direction: up ? "devUSDC->WSOL" : "WSOL->devUSDC",
    devUSDCDelta: Number(b1 - b0) / 10 ** DECIMALS_B,
    wsolDelta: Number(a1 - a0) / 10 ** DECIMALS_A,
    spotBefore: +before.pool.spot.toFixed(4),
    spotAfter: +after.pool.spot.toFixed(4),
    tickAfter: after.pool.tick,
    pyth: +after.pyth.price.toFixed(4),
    deviationBpsAfter: +after.bps.toFixed(1),
  };
  console.log(JSON.stringify(rec));
  return { rec, after, inBalance: up ? b1 : a1, inDec };
}

// ---- main -----------------------------------------------------------------

if (flag("--measure")) {
  await measure();
} else if (flag("--plan")) {
  await plan(opt("--target-deviation-bps", 200));
} else if (flag("--step")) {
  const amount = opt("--step", NaN);
  if (!(amount > 0)) throw new Error("rebalance: --step needs a positive amount of the input token");
  await step(amount, flag("--dry-run"));
} else if (flag("--until-within-bps")) {
  const target = opt("--until-within-bps", 200), maxStep = opt("--max-step", 500), maxSteps = opt("--max-steps", 12);
  let last = (await measure()).bps;
  for (let i = 0; i < maxSteps && last > target; i++) {
    const r = await step(maxStep, false);
    if (r.after.bps >= last) throw new Error(`rebalance: deviation did not improve (${last.toFixed(1)} → ${r.after.bps.toFixed(1)} bps); stopping`);
    last = r.after.bps;
    if (last > target && Number(r.inBalance) / 10 ** r.inDec < maxStep) throw new Error("rebalance: input balance below --max-step; stopping");
  }
  console.log(last <= target ? `within ${target} bps (${last.toFixed(1)})` : `stopped after ${maxSteps} steps at ${last.toFixed(1)} bps`);
} else {
  console.log("usage: --measure | --plan [--target-deviation-bps N] | --step AMOUNT [--dry-run] | --until-within-bps N [--max-step A] [--max-steps K]");
}
