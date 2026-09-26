/**
 * P4 - `liquidate_long` + `force_exercise` (ADR-0005).
 *
 * Prototype. Not audited. Single pool. Not production mainnet risk capital.
 *
 * Both let a caller close someone else's long. The assertions that matter:
 *  - L1  a healthy account is refused (`AccountSolvent`) - liquidation reads no price
 *  - L2  below maintenance: premium paid in full, bonus = min(R/2, D, 0.75 × margin)
 *  - L4  shortfall: pay what is there, no bonus, market paused, never socialized
 *  - L5  a dust shortfall (< 1 USDC) is written off: no bonus, NO pause
 *  - FX  only `FX_BAND_TICKS` past the range AND with a fresh (30 s) Pyth
 *        reference; the owner's premium is paid and the caller pays the fee
 *  - SPOOF the open-long list cannot be dropped or padded; nobody targets themselves
 * Vectors: docs/06-testing/FIXTURES-AND-VECTORS.md §8.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert, AssertionError } from "chai";
import { freshPrice, poolSpotE8, setPrice } from "./oracle-mock";

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const PERMA_WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const ORCA_VAULT_A = new PublicKey("3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4");
const ORCA_VAULT_B = new PublicKey("63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
const USER_A = new PublicKey("J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ");
const USER_B = new PublicKey("A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const LEG_SHORT = 0;
const LEG_LONG = 1;
const STATUS_OPEN = 0;

const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;
/** The demo range: spot (-39140, frozen snapshot) sits inside it. */
const DEMO = [-40176, -38168] as const;
/** Entirely above spot and more than 310 ticks from it: exercisable. */
const FX = [-38800, -38400] as const;

const SHORT_L = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

/** `state::risk_defaults`, restored in `after`. */
const HORIZON = 1_000;
const BUFFER = 1_000_000;
/** Liquidation runs at a 20-slot horizon so accrual crosses maintenance in seconds. */
const LIQ_HORIZON = 20;
const LIQ_BUFFER = 1;
const L50 = 50_000_000n;
/** margin(50e6) at 20 slots / 1 µUSDC = 20 × 50_000 + 1; maintenance takes ⌈75 %⌉. */
const LIQ_MARGIN = 1_000_001n;
const LIQ_MAINT = 750_001n;

/** ADR-0005 §2 fee: 100 slots of premium, halved per half-width from the midpoint. */
const fxFee = (L: bigint, lo: number, hi: number, tick: number) => {
  const base = (100n * 1_000_000n * L * 1_000n) / 1_000_000_000_000n;
  const hw = Math.max(1, Math.trunc((hi - lo) / 2));
  const n = Math.max(1, Math.trunc(Math.abs(tick - (lo + hw)) / hw));
  const fee = base >> BigInt(Math.min(n - 1, 10));
  return fee > 0n ? fee : 1n;
};

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("liquidation + force exercise (P4, ADR-0005)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const i32le = (v: number) => new BN(v).toTwos(32).toArrayLike(Buffer, "le", 4);

  const market = pda([Buffer.from("market"), PERMA_WHIRLPOOL.toBuffer()]);
  const marketAuthority = pda([Buffer.from("market_authority"), market.toBuffer()]);
  const globalConfig = pda([Buffer.from("global_config")]);
  const premiumIndex = pda([Buffer.from("premium_index"), market.toBuffer()]);
  const collateralOf = (owner: PublicKey) =>
    pda([Buffer.from("collateral"), market.toBuffer(), owner.toBuffer()]);
  const rangePda = ([lo, hi]: readonly number[]) =>
    pda([Buffer.from("range"), market.toBuffer(), i32le(lo), i32le(hi)]);
  const rangeVaultPda = ([lo, hi]: readonly number[]) =>
    pda([Buffer.from("range_vault"), market.toBuffer(), i32le(lo), i32le(hi)]);

  /** Disjoint nonce block - see settle-premium.ts for why. */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 7_000_000_000; // liquidation
  let n = 0;
  const nextNonce = () => NONCE_BASE + ++n;

  function posSet(owner: PublicKey, range: readonly number[]) {
    const nonce = nextNonce();
    const positionMint = Keypair.generate();
    return {
      nonce,
      owner,
      range,
      positionMint,
      orcaPosition: PublicKey.findProgramAddressSync(
        [Buffer.from("position"), positionMint.publicKey.toBuffer()],
        WHIRLPOOL_PROGRAM
      )[0],
      positionTokenAccount: PublicKey.findProgramAddressSync(
        [marketAuthority.toBuffer(), TOKEN_PROGRAM.toBuffer(), positionMint.publicKey.toBuffer()],
        ATA_PROGRAM
      )[0],
      permaPosition: pda([
        Buffer.from("perma_position"),
        market.toBuffer(),
        owner.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ]),
    };
  }
  type P = ReturnType<typeof posSet>;

  const mintAccounts = async (p: P) => ({
    owner: p.owner,
    market,
    marketAuthority,
    userCollateral: collateralOf(p.owner),
    permaPosition: p.permaPosition,
    premiumIndex,
    rangeState: rangePda(p.range),
    rangeVault: rangeVaultPda(p.range),
    whirlpool: PERMA_WHIRLPOOL,
    orcaPosition: p.orcaPosition,
    positionMint: p.positionMint.publicKey,
    positionTokenAccount: p.positionTokenAccount,
    tokenMintA: WSOL,
    tokenMintB: DEV_USDC,
    vaultA: VAULT_A,
    vaultB: VAULT_B,
    orcaVaultA: ORCA_VAULT_A,
    orcaVaultB: ORCA_VAULT_B,
    tickArrayLower: tickArrayPda(p.range[0]),
    tickArrayUpper: tickArrayPda(p.range[1]),
    tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    memoProgram: MEMO_PROGRAM,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    priceUpdate: await freshPrice(provider),
  });

  const meta = (pk: PublicKey) => ({ pubkey: pk, isSigner: false, isWritable: false });
  const openLongsOf = async (owner: PublicKey) => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ]);
    return all
      .filter((x: any) => x.account.legType === LEG_LONG && x.account.status === STATUS_OPEN)
      .map((x: any) => meta(x.publicKey));
  };

  const mintShort = async (p: P) =>
    program.methods
      .mintPosition(LEG_SHORT, p.range[0], p.range[1], SHORT_L, MAX_A, MAX_B, new BN(p.nonce))
      .accounts(await mintAccounts(p))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();

  const mintLong = async (p: P, size: bigint, signers: Keypair[]) =>
    program.methods
      .mintPosition(LEG_LONG, p.range[0], p.range[1], new BN(size.toString()), new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongsOf(p.owner))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers(signers)
      .rpc();

  const burnShort = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: rangePda(p.range),
        rangeVault: rangeVaultPda(p.range), whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey, positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
        tickArrayLower: tickArrayPda(p.range[0]), tickArrayUpper: tickArrayPda(p.range[1]),
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  const burnLong = (p: P, signers: Keypair[]) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: rangePda(p.range),
        rangeVault: rangeVaultPda(p.range),
        whirlpool: null, orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: VAULT_B,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
      })
      .signers(signers)
      .rpc();

  const closeAccounts = (caller: PublicKey, p: P, owner = p.owner) => ({
    caller, callerCollateral: collateralOf(caller), owner, market, marketAuthority,
    userCollateral: collateralOf(p.owner), permaPosition: p.permaPosition, premiumIndex,
    rangeState: rangePda(p.range), rangeVault: rangeVaultPda(p.range), vaultB: VAULT_B,
    tokenProgram: TOKEN_PROGRAM, whirlpool: null, priceUpdate: null,
  });

  type Call = { caller?: Keypair; owner?: PublicKey; remaining?: any[] };
  /** `remaining` defaults to the truth: the OWNER's open longs. */
  const liquidate = async (p: P, o: Call = {}) =>
    program.methods
      .liquidateLong()
      .accounts(closeAccounts(o.caller?.publicKey ?? me, p, o.owner))
      .remainingAccounts(o.remaining ?? (await openLongsOf(p.owner)))
      .signers(o.caller ? [o.caller] : [])
      .rpc();
  /** `remaining` defaults to the truth: the CALLER's open longs. */
  const forceExercise = async (p: P, priceUpdate: PublicKey, o: Call = {}) => {
    const caller = o.caller?.publicKey ?? me;
    return program.methods
      .forceExercise()
      .accounts({ ...closeAccounts(caller, p, o.owner), whirlpool: PERMA_WHIRLPOOL, priceUpdate })
      .remainingAccounts(o.remaining ?? (await openLongsOf(caller)))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers(o.caller ? [o.caller] : [])
      .rpc();
  };

  const deposit = (owner: PublicKey, a: bigint, b: bigint, signers: Keypair[] = []) =>
    program.methods
      .depositCollateral(new BN(a.toString()), new BN(b.toString()))
      .accounts({
        owner, market, userCollateral: collateralOf(owner),
        userTokenA: owner.equals(me) ? USER_A : getAssociatedTokenAddressSync(WSOL, owner),
        userTokenB: owner.equals(me) ? USER_B : getAssociatedTokenAddressSync(DEV_USDC, owner),
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers(signers)
      .rpc();

  /** A fresh user: SOL for fees, both ATAs, `usdc` µUSDC from the fixture, deposited. */
  const newUser = async (usdc: bigint) => {
    const kp = Keypair.generate();
    await conn.confirmTransaction(
      await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    const ataA = getAssociatedTokenAddressSync(WSOL, kp.publicKey);
    const ataB = getAssociatedTokenAddressSync(DEV_USDC, kp.publicKey);
    await provider.sendAndConfirm(
      new Transaction()
        .add(createAssociatedTokenAccountInstruction(me, ataA, kp.publicKey, WSOL))
        .add(createAssociatedTokenAccountInstruction(me, ataB, kp.publicKey, DEV_USDC))
        .add(createTransferInstruction(USER_B, ataB, me, usdc))
    );
    await deposit(kp.publicKey, 0n, usdc, [kp]);
    return kp;
  };
  /** Top `owner`'s free USDC up to exactly `target` (from their own ATA). */
  const topUpTo = async (kp: Keypair, target: bigint) => {
    const need = target - (await freeB(kp.publicKey));
    const ataB = getAssociatedTokenAddressSync(DEV_USDC, kp.publicKey);
    await provider.sendAndConfirm(new Transaction().add(createTransferInstruction(USER_B, ataB, me, need)));
    await deposit(kp.publicKey, 0n, need, [kp]);
  };

  const uc = async (owner: PublicKey) =>
    (program.account as any).userCollateral.fetch(collateralOf(owner));
  const freeB = async (owner: PublicKey) => BigInt((await uc(owner)).balanceB.toString());
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const totalLong = async (range: readonly number[]) =>
    BigInt((await (program.account as any).rangePremiumState.fetch(rangePda(range))).totalLongLiquidity.toString());
  const isPaused = async () => (await (program.account as any).market.fetch(market)).isPaused as boolean;
  const poolTick = async () => (await conn.getAccountInfo(PERMA_WHIRLPOOL))!.data.readInt32LE(81);
  const admin = { admin: me, globalConfig, market };
  const setRisk = (h: number, b: number) =>
    program.methods.setMarketRiskParams(new BN(h), new BN(b)).accounts(admin).rpc();
  const unpause = async () => {
    if (await isPaused()) await program.methods.unpauseMarket().accounts(admin).rpc();
  };
  const waitSlots = async (k: number) => {
    const from = await conn.getSlot("confirmed");
    while ((await conn.getSlot("confirmed")) < from + k) await new Promise((r) => setTimeout(r, 400));
  };
  const expectErr = async (p: Promise<unknown>, name: string) => {
    try {
      await p;
      assert.fail(`expected ${name}`);
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), name, e.toString());
    }
  };

  const shorts: P[] = [];
  const users: Keypair[] = [];

  before(async () => {
    assert.isAbove(Number(await amt(USER_B)), 0, "run node scripts/make-fixtures.mjs");
    if ((await conn.getAccountInfo(globalConfig)) === null) {
      await program.methods
        .initializeGlobalConfig(PERMA_WHIRLPOOL)
        .accounts({ admin: me, globalConfig, systemProgram: SystemProgram.programId })
        .rpc();
    }
    if ((await conn.getAccountInfo(market)) === null) {
      await program.methods
        .createMarket()
        .accounts({
          admin: me, globalConfig, market, marketAuthority,
          whirlpool: PERMA_WHIRLPOOL, vaultA: VAULT_A, vaultB: VAULT_B,
          whirlpoolProgram: WHIRLPOOL_PROGRAM, systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    // Me: WSOL for two shorts, and USDC for bonuses and fees.
    const have = (await conn.getAccountInfo(collateralOf(me))) ? await uc(me) : null;
    const hA = have ? BigInt(have.balanceA.toString()) : 0n;
    const hB = have ? BigInt(have.balanceB.toString()) : 0n;
    const topA = hA < 2_000_000_000n ? 2_000_000_000n - hA : 0n;
    const topB = hB < 150_000_000n ? 150_000_000n - hB : 0n;
    if (topA + topB > 0n) await deposit(me, topA, topB);

    for (const range of [DEMO, FX]) {
      const s = posSet(me, range);
      await mintShort(s);
      shorts.push(s);
    }
  });

  describe("liquidate_long", () => {
    let alice: Keypair;
    let a1: P;
    const FREE0 = 1_600_000n;

    before(async () => {
      await setRisk(LIQ_HORIZON, LIQ_BUFFER);
      alice = await newUser(FREE0);
      users.push(alice);
      a1 = posSet(alice.publicKey, DEMO);
      await mintLong(a1, L50, [alice]); // needs margin 1_000_001 <= 1.6e6
    });

    it("L1: a healthy account is refused AccountSolvent and nothing moves", async () => {
      // Owed after a few slots is ~150k; maintenance = owed + 750_001 < 1.6e6.
      await expectErr(liquidate(a1), "AccountSolvent");
      assert.equal(await freeB(alice.publicKey), FREE0);
      assert.equal((await uc(alice.publicKey)).openLongs, 1);
    });

    it("SPOOF: the owner's list cannot be dropped or padded; nobody liquidates themselves", async () => {
      await expectErr(liquidate(a1, { remaining: [] }), "MissingOpenLong");
      await expectErr(
        liquidate(a1, { remaining: [meta(a1.permaPosition), meta(a1.permaPosition)] }),
        "MissingOpenLong"
      );
      await expectErr(liquidate(a1, { caller: alice }), "ConstraintDuplicateMutableAccount");
    });

    it("L2: below maintenance the premium is paid in full and bonus = min(R/2, D, 0.75 × margin)", async () => {
      // 50_000 µUSDC/slot: maintenance crosses 1.6e6 after 17 slots, the
      // premium alone after 32. Liquidate in between.
      await waitSlots(22);
      const vault = rangeVaultPda(DEMO);
      const v0 = await amt(vault), me0 = await freeB(me), long0 = await totalLong(DEMO);

      await liquidate(a1);

      const paid = (await amt(vault)) - v0;
      const bonus = (await freeB(me)) - me0;
      const deficit = paid + LIQ_MAINT - FREE0; // maint − free, same slot
      const expect = [(FREE0 - paid) / 2n, deficit, LIQ_MAINT].reduce((x, y) => (x < y ? x : y));
      assert.isAbove(Number(paid), Number(FREE0 - LIQ_MAINT), "it really was below maintenance");
      assert.equal(bonus, expect, "bonus formula");
      assert.isAbove(Number(bonus), 0);
      assert.equal(await freeB(alice.publicKey), FREE0 - paid - bonus, "conservation");
      assert.equal((await uc(alice.publicKey)).openLongs, 0);
      assert.isNull(await conn.getAccountInfo(a1.permaPosition), "position closed to its owner");
      assert.equal(long0 - (await totalLong(DEMO)), L50);
      assert.isFalse(await isPaused());
    });

    it("L5: a tiny insolvent account cannot pause the market (dust shortfall is written off)", async () => {
      // L = 1e6 owes 1_000 µUSDC/slot; margin at 20 slots = 20_001. With
      // 25_000 free it is liquidatable after ~10 slots and short after ~25.
      const FREE = 25_000n;
      const dusty = await newUser(FREE);
      users.push(dusty);
      const d = posSet(dusty.publicKey, DEMO);
      await mintLong(d, 1_000_000n, [dusty]);
      await waitSlots(60); // owes >= 60_000 > free, far below 1 USDC

      const vault = rangeVaultPda(DEMO);
      const v0 = await amt(vault), me0 = await freeB(me);
      const sig = await liquidate(d);
      await conn.confirmTransaction(sig, "confirmed");
      const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const ev = [...new anchor.EventParser(program.programId, program.coder).parseLogs(tx!.meta!.logMessages!)]
        .find((e) => e.name === "longLiquidated")!.data as any;
      const shortfall = BigInt(ev.shortfall.toString());

      assert.isAbove(Number(shortfall), 0, "it really was insolvent");
      assert.isBelow(Number(shortfall), 1_000_000, "dust: under PAUSE_SHORTFALL_MIN_USDC");
      assert.equal((await amt(vault)) - v0, FREE, "everything free was paid");
      assert.equal(BigInt(ev.premiumPaid.toString()), FREE);
      assert.equal(await freeB(me), me0, "no bonus on a shortfall");
      assert.isFalse(ev.paused);
      assert.isFalse(await isPaused(), "a dust account cannot halt trading");
      assert.equal((await uc(dusty.publicKey)).openLongs, 0);
    });

    it("L4: shortfall pays what is there, no bonus, pauses; a paused market still liquidates", async () => {
      const free = 2n * LIQ_MARGIN + 500_000n; // two margins + 10 slots of the first long's accrual
      await topUpTo(alice, free);
      const b1 = posSet(alice.publicKey, DEMO);
      const b2 = posSet(alice.publicKey, DEMO);
      await mintLong(b1, L50, [alice]);
      await mintLong(b2, L50, [alice]);
      await waitSlots(100); // the first long alone owes > 5e6: shortfall > 2.5 USDC, above the pause floor

      const vault = rangeVaultPda(DEMO);
      let v0 = await amt(vault), me0 = await freeB(me);
      await liquidate(b1);
      assert.equal((await amt(vault)) - v0, free, "everything free was paid");
      assert.equal(await freeB(me), me0, "no bonus on a shortfall");
      assert.equal(await freeB(alice.publicKey), 0n);
      assert.isTrue(await isPaused(), "PRD B30: a shortfall of 1 USDC or more halts, never socializes");

      v0 = await amt(vault);
      await liquidate(b2); // Q6: allowed while paused
      assert.equal((await amt(vault)) - v0, 0n);
      assert.equal(await freeB(me), me0);
      assert.equal((await uc(alice.publicKey)).openLongs, 0);
      await unpause();
    });

    after(async () => {
      await unpause();
      await setRisk(HORIZON, BUFFER);
    });
  });

  describe("force_exercise", () => {
    let bob: Keypair;
    let fx1: P, fx2: P, demo: P;
    const L = 10_000_000n;
    let n9 = 0n;
    /** Our own tag, so unhealthy writes never reach the shared feed. */
    const price = async (o: { mult?: bigint; ageSecs?: number } = {}) => {
      const spot = await poolSpotE8(provider);
      const p = (spot * (o.mult ?? 1000n)) / 1000n;
      return setPrice(provider, { price: p, conf: p / 1000n + ++n9, ageSecs: o.ageSecs ?? 0, tag: 9 });
    };

    before(async () => {
      bob = await newUser(40_000_000n); // 3 longs × margin 11e6 at the default params
      users.push(bob);
      fx1 = posSet(bob.publicKey, FX);
      fx2 = posSet(bob.publicKey, FX);
      demo = posSet(bob.publicKey, DEMO);
      for (const p of [fx1, fx2, demo]) await mintLong(p, L, [bob]);
    });

    it("FX near: a range around spot is NotExercisable", async () => {
      await expectErr(forceExercise(demo, await price()), "NotExercisable");
    });

    it("SPOOF: nobody exercises their own long; the caller's list cannot be padded", async () => {
      await expectErr(forceExercise(fx1, await price(), { caller: bob }), "ConstraintDuplicateMutableAccount");
      await expectErr(forceExercise(fx1, await price(), { remaining: [meta(fx1.permaPosition)] }), "MissingOpenLong");
    });

    it("FX reference: a 45 s old price is OracleStale; 3.5 % off spot is OracleDeviationTooHigh", async () => {
      await expectErr(forceExercise(fx1, await price({ ageSecs: 45 })), "OracleStale");
      await expectErr(forceExercise(fx1, await price({ mult: 1035n })), "OracleDeviationTooHigh");
    });

    it("FX ok: the owner's premium is paid and the caller pays the owner the fee", async () => {
      const tick = await poolTick();
      const fee = fxFee(L, FX[0], FX[1], tick);
      assert.equal(fee, 500_000n, "the frozen pool sits 2 half-widths below the midpoint");
      const vault = rangeVaultPda(FX);
      const v0 = await amt(vault), me0 = await freeB(me), bob0 = await freeB(bob.publicKey);
      const long0 = await totalLong(FX), open0 = (await uc(bob.publicKey)).openLongs;

      await forceExercise(fx1, await price());

      const paid = (await amt(vault)) - v0;
      assert.isAbove(Number(paid), 0, "premium settled into the range vault");
      assert.equal(me0 - (await freeB(me)), fee, "caller pays the fee");
      assert.equal((await freeB(bob.publicKey)) - bob0, fee - paid, "owner: +fee −premium");
      assert.equal(long0 - (await totalLong(FX)), L, "short liquidity unpinned");
      assert.equal((await uc(bob.publicKey)).openLongs, open0 - 1);
      assert.isNull(await conn.getAccountInfo(fx1.permaPosition));
    });

    it("Q6: a paused market still force-exercises", async () => {
      await program.methods.pauseMarket().accounts(admin).rpc();
      try {
        await forceExercise(fx2, await price());
        assert.isNull(await conn.getAccountInfo(fx2.permaPosition));
      } finally {
        await unpause();
      }
    });

    after(async () => {
      if (await conn.getAccountInfo(demo.permaPosition)) await burnLong(demo, [bob]);
    });
  });

  after(async () => {
    await unpause();
    for (const u of users) {
      for (const { pubkey } of await openLongsOf(u.publicKey)) {
        const account = await (program.account as any).permaPosition.fetch(pubkey);
        const range = [account.tickLower, account.tickUpper];
        await burnLong({ ...posSet(u.publicKey, range), permaPosition: pubkey }, [u]).catch(() => {});
      }
    }
    for (const s of shorts) await burnShort(s);
    assert.equal(await totalLong(DEMO), 0n, "suite must leave no longs");
    assert.equal(await totalLong(FX), 0n);
  });
});
