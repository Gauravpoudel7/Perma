/**
 * Component 10 - Pause / Admin (Fair MVP).
 *
 * The circuit breaker finally has a switch, and it must not trap anyone.
 * Exit Guaranteed (`10-pause-admin.md`): pausing blocks every path that ADDS
 * risk - mint, deposit, lock, the adapter open/add harness - and leaves every
 * exit path open: burn, settle, withdraw (still 09-solvency-gated), unlock
 * (still `PositionsOutstanding`-gated). This suite flips the flag for real and
 * proves each cell of that matrix on a live market, then proves ADR-0003's
 * `set_market_risk_params` overflow re-validation.
 *
 * Order-independence: the release gate runs the suite list twice on one ledger,
 * then reversed. `before()` heals a market a crashed run left paused or with
 * non-default risk params; `after()` unconditionally unpauses, restores the
 * defaults, and burns everything this suite opened.
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
import { freshPrice } from "./oracle-mock";
import { testPricing } from "./pricing";

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

describe("pause-admin: circuit breaker + risk params (component 10)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;
  const pricing = testPricing(program, provider);

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
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 6_000_000_000; // pause-admin
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
    program.methods.pauseMarket().accounts(adminAccounts(admin)).signers(signers).rpc();
  const unpause = (admin = me, signers: Keypair[] = []) =>
    program.methods.unpauseMarket().accounts(adminAccounts(admin)).signers(signers).rpc();
  const setRiskParams = (h: number | BN, b: number | BN, admin = me, signers: Keypair[] = []) =>
    program.methods
      .setMarketRiskParams(new BN(h), new BN(b))
      .accounts(adminAccounts(admin))
      .signers(signers)
      .rpc();

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
      .rpc();

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
      .rpc();

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
      .rpc();

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
      .rpc();

  const settleLong = (p: P) =>
    program.methods
      .settlePremium()
      .accounts({
        cranker: me, owner: p.owner, market, marketAuthority,
        userCollateral: collateralOf(p.owner), permaPosition: p.permaPosition,
        premiumIndex, rangeState: demoRange, rangeVault: demoVault, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM,
      })
      .rpc();

  const withdraw = async (b: bigint) =>
    program.methods
      .withdrawCollateral(new BN(0), new BN(b.toString()))
      .accounts({
        owner: me, market, marketAuthority, userCollateral: collateralOf(me),
        userTokenA: USER_A, userTokenB: USER_B, vaultA: VAULT_A, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM, premiumIndex,
      })
      .remainingAccounts(await openLongsOf(me))
      .rpc();
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
      .rpc();
  const lock = (a: number, b: number, owner = me, signers: Keypair[] = []) =>
    program.methods
      .lockCollateral(new BN(a), new BN(b))
      .accounts({ owner, market, userCollateral: collateralOf(owner) })
      .signers(signers)
      .rpc();
  const unlock = (a: number, b: number, owner = me, signers: Keypair[] = []) =>
    program.methods
      .unlockCollateral(new BN(a), new BN(b))
      .accounts({ owner, market, userCollateral: collateralOf(owner) })
      .signers(signers)
      .rpc();

  /** Harness open: the pause check is the handler's first line, before Orca. */
  const adapterOpen = (p: P) =>
    program.methods
      .adapterOpenPosition(TICK_LOWER, TICK_UPPER, new BN(p.nonce))
      .accounts({
        owner: me, market, marketAuthority, permaPosition: p.permaPosition,
        whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey, positionTokenAccount: p.positionTokenAccount,
        tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM, systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([p.positionMint])
      .rpc();
  /** Harness add against an existing (product-path) short: same first line. */
  const adapterAdd = (p: P) =>
    program.methods
      .adapterAddLiquidity(TICK_LOWER, TICK_UPPER, new BN(1), MAX_A, MAX_B)
      .accounts({
        owner: me, market, marketAuthority, permaPosition: p.permaPosition,
        whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B, tickArrayLower, tickArrayUpper,
        rangeState: demoRange,
        tokenProgramA: TOKEN_PROGRAM, tokenProgramB: TOKEN_PROGRAM,
        memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

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
  const sizeOf = async (builder: any) => {
    const tx = await builder.transaction();
    tx.feePayer = me;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  };

  /** Everything this suite opens, so `after()` can close it whatever happened. */
  const openShorts: P[] = [];
  let seedShort: P;
  let seedLong: P;

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
    await pricing.enable();
    // A crashed earlier run must not decide this one's starting state.
    await heal();

    const have = (await conn.getAccountInfo(collateralOf(me))) ? await uc() : { balanceA: new BN(0) };
    const hA = BigInt(have.balanceA.toString());
    if (hA < 2_000_000_000n) {
      const topA = 2_000_000_000n - hA < (await amt(USER_A)) ? 2_000_000_000n - hA : await amt(USER_A);
      await deposit(topA, 0n);
    }
    await ensureFreeB(USDC(250));

    // The stranger: SOL for fees, both ATAs, 1 USDC from the fixture,
    // deposited, and 1 µUSDC locked (while unpaused) for the unlock case.
    await conn.confirmTransaction(
      await conn.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );
    const tx = new Transaction()
      .add(createAssociatedTokenAccountInstruction(me, strangerA, stranger.publicKey, WSOL))
      .add(createAssociatedTokenAccountInstruction(me, strangerB, stranger.publicKey, DEV_USDC))
      .add(createTransferInstruction(USER_B, strangerB, me, USDC(1)));
    await provider.sendAndConfirm(tx);
    await deposit(0n, USDC(1), stranger.publicKey, [stranger]);
    await lock(0, 1, stranger.publicKey, [stranger]);

    seedShort = posSet(nextNonce());
    await mintShort(seedShort);
    openShorts.push(seedShort);
    seedLong = posSet(nextNonce());
    // ~0.28 USDC of notional: enough to accrue a settleable µUSDC in a few slots (ADR-0006).
    await mintLong(seedLong, new BN(10_000_000));
  });

  it("starts unpaused with the demo risk parameters", async () => {
    assert.isFalse(await isPaused());
    const m = await marketState();
    assert.equal(m.longMarginHorizonSlots.toNumber(), HORIZON);
    assert.equal(m.longMarginBufferUsdc.toNumber(), BUFFER);
  });

  it("only the admin can pause, unpause, or set risk params", async () => {
    await expectErr(pause(stranger.publicKey, [stranger]), "Unauthorized");
    await expectErr(unpause(stranger.publicKey, [stranger]), "Unauthorized");
    await expectErr(setRiskParams(HORIZON, BUFFER, stranger.publicKey, [stranger]), "Unauthorized");
    assert.isFalse(await isPaused(), "nothing changed");
  });

  it("the three admin instructions are tiny (Q6)", async () => {
    const sizes = {
      pause_market: await sizeOf(program.methods.pauseMarket().accounts(adminAccounts())),
      unpause_market: await sizeOf(program.methods.unpauseMarket().accounts(adminAccounts())),
      set_market_risk_params: await sizeOf(
        program.methods.setMarketRiskParams(new BN(HORIZON), new BN(BUFFER)).accounts(adminAccounts())
      ),
    };
    console.log("      tx sizes (bytes):", sizes);
    for (const s of Object.values(sizes)) assert.isBelow(s, 400);
  });

  describe("while paused", () => {
    before(async () => {
      await pause();
      assert.isTrue(await isPaused());
    });
    after(async () => {
      await unpause();
      assert.isFalse(await isPaused());
    });

    it("pausing an already-paused market is a no-op, not an error", async () => {
      await pause();
      assert.isTrue(await isPaused());
    });

    it("mint_position is rejected for both legs", async () => {
      await expectErr(mintShort(posSet(nextNonce())), "MarketPaused");
      await expectErr(mintLong(posSet(nextNonce()), new BN(1)), "MarketPaused");
    });

    it("deposit_collateral and lock_collateral are rejected", async () => {
      await expectErr(deposit(0n, 1n), "MarketPaused");
      await expectErr(lock(0, 1), "MarketPaused");
    });

    it("the adapter open/add harness is rejected with MarketPaused, not the allowlist error", async () => {
      const p = posSet(nextNonce());
      await expectErr(adapterOpen(p), "MarketPaused", "WhirlpoolNotAllowlisted");
      assert.isNull(await conn.getAccountInfo(p.permaPosition), "init rolled back");
      await expectErr(adapterAdd(seedShort), "MarketPaused", "WhirlpoolNotAllowlisted");
    });

    it("settle_premium still works", async () => {
      await settleLong(seedLong);
    });

    it("withdraw_collateral still works (still solvency-gated)", async () => {
      const before = await freeB();
      await withdraw(USDC(1));
      assert.equal(await freeB(), before - USDC(1));
    });

    it("burn_position still works for a long, then a short", async () => {
      const longs0 = (await uc()).openLongs as number;
      const open0 = (await uc()).openPositions as number;
      await burnLong(seedLong);
      assert.equal((await uc()).openLongs, longs0 - 1);
      await burnShort(seedShort);
      openShorts.splice(openShorts.indexOf(seedShort), 1);
      // `open_positions` counts shorts (it backs locked collateral); longs
      // live in `open_longs`. Both legs are gone.
      assert.equal((await uc()).openPositions, open0 - 1, "the short exited under pause");
      assert.isNull(await conn.getAccountInfo(seedLong.permaPosition), "the long is closed");
    });

    it("unlock_collateral still works for an owner with nothing outstanding", async () => {
      assert.equal((await uc(stranger.publicKey)).openPositions, 0);
      const lockedBefore = BigInt((await uc(stranger.publicKey)).lockedB.toString());
      await unlock(0, 1, stranger.publicKey, [stranger]);
      assert.equal(BigInt((await uc(stranger.publicKey)).lockedB.toString()), lockedBefore - 1n);
    });
  });

  describe("after unpause", () => {
    it("unpausing an unpaused market is a no-op, not an error", async () => {
      assert.isFalse(await isPaused());
      await unpause();
      assert.isFalse(await isPaused());
    });

    it("mint, deposit, and lock work again", async () => {
      const s = posSet(nextNonce());
      await mintShort(s);
      openShorts.push(s);
      await mintLong(posSet(nextNonce()), new BN(1_000));
      await deposit(0n, 1n);
      await lock(0, 1, stranger.publicKey, [stranger]);
      await unlock(0, 1, stranger.publicKey, [stranger]);
      // `me` has open positions again: unlock's own gate, not the pause, says no.
      await expectErr(unlock(0, 1), "PositionsOutstanding", "MarketPaused");
    });
  });

  describe("set_market_risk_params (ADR-0003 forward requirement)", () => {
    it("the admin can set both fields, and they read back", async () => {
      await setRiskParams(2_000, 2_000_000);
      const m = await marketState();
      assert.equal(m.longMarginHorizonSlots.toNumber(), 2_000);
      assert.equal(m.longMarginBufferUsdc.toNumber(), 2_000_000);
      // The premium parameters are not this instruction's to touch.
      assert.equal(m.premiumRate.toNumber(), 1_000_000);
      assert.equal(m.premiumMultiplier.toNumber(), 1_000);
      await setRiskParams(HORIZON, BUFFER);
    });

    it("a horizon whose 8-long margin sum would overflow u64 is rejected", async () => {
      await expectErr(setRiskParams(1_000_000, BUFFER), "InvalidRiskParams");
    });

    it("a horizon that overflows the product chain is rejected", async () => {
      await expectErr(setRiskParams(new BN("18446744073709551615"), BUFFER), "InvalidRiskParams");
    });

    it("a zero horizon or zero buffer is rejected", async () => {
      await expectErr(setRiskParams(0, BUFFER), "InvalidRiskParams");
      await expectErr(setRiskParams(HORIZON, 0), "InvalidRiskParams");
      const m = await marketState();
      assert.equal(m.longMarginHorizonSlots.toNumber(), HORIZON, "rejections write nothing");
      assert.equal(m.longMarginBufferUsdc.toNumber(), BUFFER);
    });
  });

  after(async () => {
    // Unconditional: whatever failed above, the next suite gets an unpaused
    // market at the demo parameters with none of our positions in it.
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
    await pricing.restore();
  });
});
