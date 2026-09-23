/**
 * Component 11 - Events / thin indexing (Fair MVP).
 *
 * Every prior suite asserts account state; none reads a single event. This
 * one decodes the Anchor events a confirmed transaction actually emitted -
 * exactly what `apps/web/src/lib/events.ts` does after a tx - and pins the
 * catalog in `docs/03-api-interfaces/EVENT-CATALOG.md`: names, fields, and
 * the two rules that matter to a consumer (a no-op pause emits nothing;
 * `PremiumSettled` only appears when cash actually moved).
 *
 * Self-healing like pause-admin.ts: `before()` unpauses / restores defaults if
 * a crashed run left them, `after()` unpauses and burns everything it opened.
 */
import * as anchor from "@coral-xyz/anchor";
import { EventParser, Program } from "@coral-xyz/anchor";
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
import { freshPrice } from "./oracle-mock";

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
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;
const SHORT_L = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

/** `state::risk_defaults` - what `after()` restores. */
const HORIZON = 1_000;
const BUFFER = 1_000_000;

const USDC = (n: number) => BigInt(n) * 1_000_000n;

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("events: decodable on-chain events (component 11)", () => {
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
  const rangePda = (lo: number, hi: number) =>
    pda([Buffer.from("range"), market.toBuffer(), i32le(lo), i32le(hi)]);
  const rangeVaultPda = (lo: number, hi: number) =>
    pda([Buffer.from("range_vault"), market.toBuffer(), i32le(lo), i32le(hi)]);
  const demoRange = rangePda(TICK_LOWER, TICK_UPPER);
  const demoVault = rangeVaultPda(TICK_LOWER, TICK_UPPER);
  const tickArrayLower = tickArrayPda(TICK_LOWER);
  const tickArrayUpper = tickArrayPda(TICK_UPPER);

  /** Disjoint nonce block - see settle-premium.ts for why. */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 7_000_000_000; // events
  let n = 0;
  const nextNonce = () => NONCE_BASE + ++n;

  function posSet(nonce: number, owner: PublicKey = me) {
    const positionMint = Keypair.generate();
    return {
      nonce,
      owner,
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

  /**
   * Not the admin: signs to earn `Unauthorized`. Also the only owner with no
   * positions, so it is the one who can prove unlock-while-paused -
   * `unlock_collateral`'s own gate is `open_positions == 0` per owner, and
   * other suites legitimately leave `me`'s shorts open.
   */
  const stranger = Keypair.generate();
  const strangerA = getAssociatedTokenAddressSync(WSOL, stranger.publicKey);
  const strangerB = getAssociatedTokenAddressSync(DEV_USDC, stranger.publicKey);

  // --- admin instructions -------------------------------------------------

  const adminAccounts = (admin: PublicKey = me) => ({ admin, globalConfig, market });
  const pause = (admin = me, signers: Keypair[] = []) =>
    program.methods.pauseMarket().accounts(adminAccounts(admin)).signers(signers).rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const unpause = (admin = me, signers: Keypair[] = []) =>
    program.methods.unpauseMarket().accounts(adminAccounts(admin)).signers(signers).rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const setRiskParams = (h: number | BN, b: number | BN, admin = me, signers: Keypair[] = []) =>
    program.methods
      .setMarketRiskParams(new BN(h), new BN(b))
      .accounts(adminAccounts(admin))
      .signers(signers)
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const marketState = () => (program.account as any).market.fetch(market);
  const isPaused = async () => (await marketState()).isPaused as boolean;

  // --- user instructions (copied from risk-solvency.ts / collateral.ts /
  //     adapter-liquidity.ts - the repo keeps suites self-contained) -------

  const mintAccounts = async (p: P, lo: number, hi: number) => ({
    owner: p.owner,
    market,
    marketAuthority,
    userCollateral: collateralOf(p.owner),
    permaPosition: p.permaPosition,
    premiumIndex,
    rangeState: rangePda(lo, hi),
    rangeVault: rangeVaultPda(lo, hi),
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
    tickArrayLower: tickArrayPda(lo),
    tickArrayUpper: tickArrayPda(hi),
    tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    memoProgram: MEMO_PROGRAM,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    priceUpdate: await freshPrice(provider),
  });

  const openLongsOf = async (owner: PublicKey) => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ]);
    return all
      .filter((x: any) => x.account.legType === LEG_LONG && x.account.status === STATUS_OPEN)
      .map((x: any) => ({ pubkey: x.publicKey, isSigner: false, isWritable: false }));
  };

  const mintShort = async (p: P) =>
    program.methods
      .mintPosition(LEG_SHORT, TICK_LOWER, TICK_UPPER, SHORT_L, MAX_A, MAX_B, new BN(p.nonce))
      .accounts(await mintAccounts(p, TICK_LOWER, TICK_UPPER))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const mintLong = async (p: P, size: BN) =>
    program.methods
      .mintPosition(LEG_LONG, TICK_LOWER, TICK_UPPER, size, new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p, TICK_LOWER, TICK_UPPER),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongsOf(p.owner))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const burnShort = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: demoRange, rangeVault: demoVault,
        whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey, positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B, tickArrayLower, tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const burnLong = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: demoRange, rangeVault: demoVault,
        whirlpool: null, orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: VAULT_B,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
      })
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const settleLong = (p: P) =>
    program.methods
      .settlePremium()
      .accounts({
        cranker: me, owner: p.owner, market, marketAuthority,
        userCollateral: collateralOf(p.owner), permaPosition: p.permaPosition,
        premiumIndex, rangeState: demoRange, rangeVault: demoVault, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM,
      })
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

  const withdraw = async (b: bigint) =>
    program.methods
      .withdrawCollateral(new BN(0), new BN(b.toString()))
      .accounts({
        owner: me, market, marketAuthority, userCollateral: collateralOf(me),
        userTokenA: USER_A, userTokenB: USER_B, vaultA: VAULT_A, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM, premiumIndex,
      })
      .remainingAccounts(await openLongsOf(me))
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const deposit = (a: bigint, b: bigint, owner = me, signers: Keypair[] = []) =>
    program.methods
      .depositCollateral(new BN(a.toString()), new BN(b.toString()))
      .accounts({
        owner, market, userCollateral: collateralOf(owner),
        userTokenA: owner.equals(me) ? USER_A : strangerA,
        userTokenB: owner.equals(me) ? USER_B : strangerB,
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers(signers)
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const lock = (a: number, b: number, owner = me, signers: Keypair[] = []) =>
    program.methods
      .lockCollateral(new BN(a), new BN(b))
      .accounts({ owner, market, userCollateral: collateralOf(owner) })
      .signers(signers)
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const unlock = (a: number, b: number, owner = me, signers: Keypair[] = []) =>
    program.methods
      .unlockCollateral(new BN(a), new BN(b))
      .accounts({ owner, market, userCollateral: collateralOf(owner) })
      .signers(signers)
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });


  const uc = async (owner = me) => (program.account as any).userCollateral.fetch(collateralOf(owner));
  const freeB = async () => BigInt((await uc()).balanceB.toString());
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const rangeOf = () => (program.account as any).rangePremiumState.fetch(demoRange);
  const expectErr = async (p: Promise<unknown>, name: string, not?: string) => {
    try {
      await p;
      assert.fail(`expected ${name}`);
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), name);
      if (not) assert.notInclude(e.toString(), not);
    }
  };
  const ensureFreeB = async (min: bigint) => {
    const have = await freeB();
    if (have >= min) return;
    const top = min - have < (await amt(USER_B)) ? min - have : await amt(USER_B);
    if (top > 0n) await deposit(0n, top);
  };

  // --- component 11: the event side ---------------------------------------

  const parser = new EventParser(program.programId, program.coder);
  /** Decode every PERMA event in a confirmed tx. Retries while the RPC catches up. */
  const eventsOf = async (sig: string) => {
    for (let i = 0; i < 20; i++) {
      const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx?.meta?.logMessages) return [...parser.parseLogs(tx.meta.logMessages)];
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`tx ${sig} never became visible at confirmed`);
  };
  const only = (events: { name: string }[], name: string) => {
    const hits = events.filter((e) => e.name === name);
    assert.equal(hits.length, 1, `expected exactly one ${name}, got [${events.map((e) => e.name)}]`);
    return hits[0] as { name: string; data: any };
  };
  const settleShort = (p: P) =>
    program.methods
      .settlePremium()
      .accounts({
        cranker: me, owner: p.owner, market, marketAuthority,
        userCollateral: collateralOf(p.owner), permaPosition: p.permaPosition,
        premiumIndex, rangeState: demoRange, rangeVault: demoVault, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM,
      })
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
  const waitSlots = async (k: number) => {
    const from = await conn.getSlot("confirmed");
    while ((await conn.getSlot("confirmed")) < from + k) await new Promise((r) => setTimeout(r, 400));
  };

  const openShorts: P[] = [];
  let seedShort: P;
  let seedLong: P;
  const LONG_SIZE = new BN(10_000_000);

  const heal = async () => {
    if (await isPaused()) await unpause();
    const m = await marketState();
    if (m.longMarginHorizonSlots.toNumber() !== HORIZON || m.longMarginBufferUsdc.toNumber() !== BUFFER) {
      await setRiskParams(HORIZON, BUFFER);
    }
  };

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
    await heal();
    const have = (await conn.getAccountInfo(collateralOf(me))) ? await uc() : { balanceA: new BN(0) };
    const hA = BigInt(have.balanceA.toString());
    if (hA < 2_000_000_000n) {
      const topA = 2_000_000_000n - hA < (await amt(USER_A)) ? 2_000_000_000n - hA : await amt(USER_A);
      await deposit(topA, 0n);
    }
    await ensureFreeB(USDC(250));
  });

  it("every one of the 21 catalogued events is in the IDL with a discriminator", () => {
    const names = (program.idl as any).events.map((e: any) => e.name).sort();
    // 19 Fair events + the two P1 admin events (`AdminTransferred`,
    // `RangeUnwound`). Additive only: nothing above was renamed or reordered.
    assert.equal(names.length, 21);
    for (const n of ["shortMinted", "longMinted", "shortBurned", "longBurned", "premiumSettled",
      "marketPauseSet", "marketPauseCleared", "marketRiskParamsSet"]) {
      assert.include(names, n);
    }
  });

  it("mint SHORT emits exactly one ShortMinted with the observed lock", async () => {
    seedShort = posSet(nextNonce());
    const ev = only(await eventsOf(await mintShort(seedShort)), "shortMinted");
    openShorts.push(seedShort);
    assert.isTrue(ev.data.owner.equals(me));
    assert.isTrue(ev.data.permaPosition.equals(seedShort.permaPosition));
    assert.equal(ev.data.liquidity.toString(), SHORT_L.toString());
    assert.equal(ev.data.tickLower, TICK_LOWER);
    assert.equal(ev.data.tickUpper, TICK_UPPER);
    const pos = await (program.account as any).permaPosition.fetch(seedShort.permaPosition);
    assert.equal(ev.data.lockedB.toString(), pos.lockedB.toString(), "event reports what was locked");
    assert.equal(ev.data.openPositions, (await uc()).openPositions);
  });

  it("mint LONG emits LongMinted with the inventory snapshot the range now holds", async () => {
    seedLong = posSet(nextNonce());
    const ev = only(await eventsOf(await mintLong(seedLong, LONG_SIZE)), "longMinted");
    assert.equal(ev.data.size.toString(), LONG_SIZE.toString());
    const r = await rangeOf();
    assert.equal(ev.data.totalLongLiquidity.toString(), r.totalLongLiquidity.toString());
    assert.equal(ev.data.totalShortLiquidity.toString(), r.totalShortLiquidity.toString());
    assert.equal(
      ev.data.availableAfter.toString(),
      (BigInt(r.totalShortLiquidity.toString()) - BigInt(r.totalLongLiquidity.toString())).toString()
    );
  });

  it("settle LONG emits PremiumSettled(leg 1) whose amount is exactly the cash that moved", async () => {
    await waitSlots(4);
    const esc0 = await amt(demoVault);
    const ev = only(await eventsOf(await settleLong(seedLong)), "premiumSettled");
    assert.equal(ev.data.legType, LEG_LONG);
    assert.isAbove(Number(ev.data.amount), 0);
    assert.equal(BigInt(ev.data.amount.toString()), (await amt(demoVault)) - esc0, "amount == escrow delta");
    assert.isTrue(ev.data.permaPosition.equals(seedLong.permaPosition));
  });

  it("settle SHORT emits PremiumSettled(leg 0) for the cash claimed out of the escrow", async () => {
    const esc0 = await amt(demoVault);
    const ev = only(await eventsOf(await settleShort(seedShort)), "premiumSettled");
    assert.equal(ev.data.legType, LEG_SHORT);
    assert.isAbove(Number(ev.data.amount), 0);
    assert.equal(BigInt(ev.data.amount.toString()), esc0 - (await amt(demoVault)), "amount == escrow delta");
  });

  it("burn LONG emits LongBurned; burn SHORT emits ShortBurned whose status matches the account", async () => {
    const lb = only(await eventsOf(await burnLong(seedLong)), "longBurned");
    assert.equal(lb.data.size.toString(), LONG_SIZE.toString());
    assert.isNull(await conn.getAccountInfo(seedLong.permaPosition));

    const sb = only(await eventsOf(await burnShort(seedShort)), "shortBurned");
    openShorts.splice(openShorts.indexOf(seedShort), 1);
    assert.equal(sb.data.liquidity.toString(), SHORT_L.toString());
    const stillExists = (await conn.getAccountInfo(seedShort.permaPosition)) !== null;
    // CLOSED (1) → account gone; PENDING_PREMIUM (2) → account kept until its claim is paid.
    assert.equal(sb.data.status, stillExists ? 2 : 1, "status field tells a consumer whether to keep the row");
    if (!stillExists) assert.equal(sb.data.premiumReceivable.toString(), "0");
  });

  it("pause emits MarketPauseSet once; a second pause is a no-op with ZERO events; unpause emits MarketPauseCleared", async () => {
    const set = only(await eventsOf(await pause()), "marketPauseSet");
    assert.isTrue(set.data.admin.equals(me));
    assert.isTrue(set.data.market.equals(market));

    const again = await eventsOf(await pause());
    assert.deepEqual(again.map((e) => e.name), [], "idempotent no-op emits nothing");

    const cleared = only(await eventsOf(await unpause()), "marketPauseCleared");
    assert.isTrue(cleared.data.admin.equals(me));
  });

  it("set_market_risk_params emits MarketRiskParamsSet with the values written", async () => {
    const ev = only(await eventsOf(await setRiskParams(2_000, 2_000_000)), "marketRiskParamsSet");
    assert.equal(ev.data.longMarginHorizonSlots.toNumber(), 2_000);
    assert.equal(ev.data.longMarginBufferUsdc.toNumber(), 2_000_000);
    await setRiskParams(HORIZON, BUFFER);
  });

  it("a failed instruction emits nothing a consumer could mistake for state", async () => {
    await pause();
    try {
      await deposit(0n, 1n);
      assert.fail("expected MarketPaused");
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), "MarketPaused");
      const logs: string[] = e.logs ?? [];
      assert.deepEqual([...parser.parseLogs(logs)].map((x) => x.name), []);
    } finally {
      await unpause();
    }
  });

  after(async () => {
    await unpause().catch(() => {});
    await setRiskParams(HORIZON, BUFFER).catch(() => {});
    for (const { pubkey } of await openLongsOf(me)) {
      const account = await (program.account as any).permaPosition.fetch(pubkey);
      const p = { ...posSet(Number(account.nonce)), permaPosition: pubkey };
      await burnLong(p).catch(() => {});
    }
    for (const s of openShorts) await burnShort(s).catch(() => {});
    assert.isFalse(await isPaused(), "suite must leave the market unpaused");
    const r = await rangeOf();
    assert.equal(r.totalLongLiquidity.toString(), "0", "suite must leave no longs");
  });
});
