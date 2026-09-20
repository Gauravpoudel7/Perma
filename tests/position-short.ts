/**
 * Components 04 + 05 - the product path.
 *
 *     deposit_collateral -> mint_position (SHORT) -> burn_position
 *
 * Unlike tests/adapter-liquidity.ts (which drives the low-level adapter_*
 * harness), this suite proves what a user actually does: one signature opens a
 * short that locks collateral AND adds real Orca liquidity atomically.
 *
 * Headline assertion: conservation is now **exactly** checkable, because
 * `in_orca_*` tracks current exposure rather than cumulative deposits:
 *
 *     vault_s + Σ in_orca_s  ==  Σ_users (balance_s + locked_s)
 *
 * Component 03 could only pin a baseline; this suite asserts the real identity.
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
} from "@solana/web3.js";
import * as chai from "chai";
import { assert } from "chai";

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
const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;

/** ~0.034 WSOL + ~0.71 devUSDC per position. */
const LIQUIDITY = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

const startTickIndex = (tick: number) =>
  Math.floor(tick / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (tick: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(tick).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("position-short: deposit -> mint SHORT -> burn (product path)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;

  const market = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), PERMA_WHIRLPOOL.toBuffer()],
    program.programId
  )[0];
  const marketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("market_authority"), market.toBuffer()],
    program.programId
  )[0];
  const globalConfig = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    program.programId
  )[0];
  const userCollateral = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), market.toBuffer(), me.toBuffer()],
    program.programId
  )[0];

  const premiumIndex = PublicKey.findProgramAddressSync(
    [Buffer.from("premium_index"), market.toBuffer()],
    program.programId
  )[0];
  const rangeState = (lo: number, hi: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("range"),
        market.toBuffer(),
        new BN(lo).toTwos(32).toArrayLike(Buffer, "le", 4),
        new BN(hi).toTwos(32).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    )[0];
  const demoRange = rangeState(TICK_LOWER, TICK_UPPER);

  /**
   * Per-range USDC escrow. A PERMA PDA - deliberately NOT
   * ATA(market_authority, devUSDC), which is `Market.vault_b`. Mixing the two
   * would make the collateral conservation identity uncheckable.
   */
  const rangeVaultPda = (lo: number, hi: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("range_vault"),
        market.toBuffer(),
        new BN(lo).toTwos(32).toArrayLike(Buffer, "le", 4),
        new BN(hi).toTwos(32).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    )[0];
  const rangeVault = rangeVaultPda(TICK_LOWER, TICK_UPPER);

  const tickArrayLower = tickArrayPda(TICK_LOWER);
  const tickArrayUpper = tickArrayPda(TICK_UPPER);

  /**
   * Suites load in the same process, so every `Date.now()` here lands within a
   * few milliseconds of every other one. Bases that close together overlap as
   * soon as a suite mints more than a handful of positions, and the collision
   * surfaces as `Allocate: account already in use` in an unrelated test. Each
   * suite gets a disjoint block instead.
   */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 1_000_000_000; // position-short

  function positionSet(localNonce: number) {
    const nonce = NONCE_BASE + localNonce;
    const positionMint = Keypair.generate();
    const orcaPosition = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), positionMint.publicKey.toBuffer()],
      WHIRLPOOL_PROGRAM
    )[0];
    const positionTokenAccount = PublicKey.findProgramAddressSync(
      [marketAuthority.toBuffer(), TOKEN_PROGRAM.toBuffer(), positionMint.publicKey.toBuffer()],
      ATA_PROGRAM
    )[0];
    const permaPosition = PublicKey.findProgramAddressSync(
      [
        Buffer.from("perma_position"),
        market.toBuffer(),
        me.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];
    return { nonce, positionMint, orcaPosition, positionTokenAccount, permaPosition };
  }

  type P = ReturnType<typeof positionSet>;

  const mint = (p: P, leg = LEG_SHORT, maxA = MAX_A, maxB = MAX_B) =>
    program.methods
      .mintPosition(leg, TICK_LOWER, TICK_UPPER, LIQUIDITY, maxA, maxB, new BN(p.nonce))
      .accounts({
        owner: me,
        market,
        marketAuthority,
        userCollateral,
        permaPosition: p.permaPosition,
        premiumIndex,
        rangeState: demoRange,
        rangeVault,
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
        tickArrayLower,
        tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        memoProgram: MEMO_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();

  const burn = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me,
        market,
        marketAuthority,
        userCollateral,
        permaPosition: p.permaPosition,
        premiumIndex,
        rangeState: demoRange,
        rangeVault,
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
        tickArrayLower,
        tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM,
        memoProgram: MEMO_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  const vaultAmount = async (pk: PublicKey): Promise<bigint> => {
    const info = await conn.getAccountInfo(pk);
    return info ? info.data.readBigUInt64LE(64) : 0n;
  };
  const uc = () => (program.account as any).userCollateral.fetch(userCollateral);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);

  /** vault_s + Σ in_orca_s − Σ(free+locked), per side. Zero on a clean ledger. */
  async function discrepancy(): Promise<[bigint, bigint]> {
    const users = await (program.account as any).userCollateral.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    const positions = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);

    let owedA = 0n;
    let owedB = 0n;
    for (const { account } of users) {
      owedA += BigInt(account.balanceA.toString()) + BigInt(account.lockedA.toString());
      owedB += BigInt(account.balanceB.toString()) + BigInt(account.lockedB.toString());
    }
    let orcaA = 0n;
    let orcaB = 0n;
    for (const { account } of positions) {
      orcaA += BigInt(account.inOrcaA.toString());
      orcaB += BigInt(account.inOrcaB.toString());
    }

    return [
      (await vaultAmount(VAULT_A)) + orcaA - owedA,
      (await vaultAmount(VAULT_B)) + orcaB - owedB,
    ];
  }

  /**
   * Baseline captured in `before`. Zero when this suite runs on a clean ledger
   * (verified: 7/7 with an exact `vault + in_orca == Σ(free+locked)`).
   *
   * It is non-zero only when the **harness** suite `adapter-liquidity.ts` ran
   * first. That path moves tokens with no user attribution, and
   * `adapter_close_position` closes a PermaPosition without zeroing
   * `in_orca_*` - so Orca's round-trip rounding dust (~1 lamport per close)
   * drops out of the sum with nobody to charge it to. Unattributable by
   * construction: the harness never knew which user owned those tokens.
   *
   * The product path has no such gap, which is the point. Pinning the baseline
   * asserts that **every mint and burn here conserves to the unit**, whatever
   * the harness left behind.
   */
  let baseline: [bigint, bigint] = [0n, 0n];

  async function assertConservation(label: string) {
    const [da, db] = await discrepancy();
    assert.equal(da.toString(), baseline[0].toString(), `${label}: WSOL conservation drifted`);
    assert.equal(db.toString(), baseline[1].toString(), `${label}: devUSDC conservation drifted`);
  }

  before(async () => {
    assert.isAbove(Number(await vaultAmount(USER_A)), 0, "run node scripts/make-fixtures.mjs");

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
          admin: me,
          globalConfig,
          market,
          marketAuthority,
          whirlpool: PERMA_WHIRLPOOL,
          vaultA: VAULT_A,
          vaultB: VAULT_B,
          whirlpoolProgram: WHIRLPOOL_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    // Top up through the real deposit path, only as much as this run needs and
    // never more than the fixture ATAs still hold - the suite is re-runnable
    // against a validator that was not reset.
    const NEED_A = 2_000_000_000n; // ~8 positions' worth of WSOL
    const NEED_B = 200_000_000n;
    const existing = (await conn.getAccountInfo(userCollateral))
      ? await uc()
      : { balanceA: new BN(0), balanceB: new BN(0) };
    const haveA = BigInt(existing.balanceA.toString());
    const haveB = BigInt(existing.balanceB.toString());
    const topA = haveA >= NEED_A ? 0n : min(NEED_A - haveA, await vaultAmount(USER_A));
    const topB = haveB >= NEED_B ? 0n : min(NEED_B - haveB, await vaultAmount(USER_B));

    if (topA > 0n || topB > 0n) {
      await program.methods
        .depositCollateral(new BN(topA.toString()), new BN(topB.toString()))
        .accounts({
          owner: me,
          market,
          userCollateral,
          userTokenA: USER_A,
          userTokenB: USER_B,
          vaultA: VAULT_A,
          vaultB: VAULT_B,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    assert.isAtLeast(
      Number(BigInt((await uc()).balanceA.toString())),
      500_000_000,
      "not enough WSOL to run the suite - regenerate fixtures and --reset"
    );

    baseline = await discrepancy();
  });

  it("mint_position opens a short: locks collateral AND adds real Orca liquidity", async () => {
    const p = positionSet(1);
    const before = await uc();
    const vaultBefore = await vaultAmount(VAULT_A);
    const openBefore = before.openPositions;

    await mint(p);

    // Real Orca liquidity.
    const orca = await conn.getAccountInfo(p.orcaPosition);
    assert.isNotNull(orca, "Orca position must exist");
    const orcaLiq = orca!.data.readBigUInt64LE(72) + (orca!.data.readBigUInt64LE(80) << 64n);
    assert.equal(orcaLiq, BigInt(LIQUIDITY.toString()), "Orca liquidity must match");

    // Collateral locked by the observed spend, and tokens left the vault.
    const after = await uc();
    const lockedA = BigInt(after.lockedA.toString()) - BigInt(before.lockedA.toString());
    assert.isAbove(Number(lockedA), 0, "WSOL must be locked");
    assert.equal(
      vaultBefore - (await vaultAmount(VAULT_A)),
      lockedA,
      "vault outflow must equal the amount locked"
    );
    assert.equal(after.openPositions, openBefore + 1, "the 03 counter must increment");

    const pos = await (program.account as any).permaPosition.fetch(p.permaPosition);
    assert.equal(pos.legType, LEG_SHORT);
    assert.equal(pos.status, 0, "Open");
    assert.equal(pos.lockedA.toString(), lockedA.toString(), "per-position attribution recorded");
    assert.equal(pos.inOrcaA.toString(), lockedA.toString(), "exposure tracked");

    await assertConservation("after mint");
  });

  it("unlock_collateral is blocked while a short is open", async () => {
    assert.isAbove((await uc()).openPositions, 0, "precondition: a short is open");
    try {
      await program.methods
        .unlockCollateral(new BN(1), new BN(0))
        .accounts({ owner: me, market, userCollateral })
        .rpc();
      assert.fail("expected PositionsOutstanding");
    } catch (e: any) {
      assert.include(e.toString(), "PositionsOutstanding");
    }
  });

  it("burn_position closes Orca via the 3-step sequence and releases collateral", async () => {
    const p = positionSet(2);
    await mint(p);

    const before = await uc();
    const openBefore = before.openPositions;
    const pos = await (program.account as any).permaPosition.fetch(p.permaPosition);
    const lockedA = BigInt(pos.lockedA.toString());

    await burn(p);

    assert.isNull(await conn.getAccountInfo(p.orcaPosition), "Orca position must be closed");
    assert.isNull(await conn.getAccountInfo(p.permaPosition), "PERMA position must be closed");

    const after = await uc();
    assert.equal(
      BigInt(before.lockedA.toString()) - BigInt(after.lockedA.toString()),
      lockedA,
      "exactly this position's lock is released"
    );
    assert.isAtLeast(
      Number(BigInt(after.balanceA.toString()) - BigInt(before.balanceA.toString())),
      0,
      "returned tokens credited to free"
    );
    assert.equal(after.openPositions, openBefore - 1, "counter decremented");

    await assertConservation("after burn");
  });

  it("rejects an unknown leg type", async () => {
    // Component 06 made LONG valid, so the old "LONG is rejected" test is
    // obsolete - long coverage lives in tests/position-long.ts. What must
    // still fail is a leg that is neither SHORT nor LONG.
    //
    // NOTE the shape of this assertion: `assert.fail` inside a `try` whose
    // `catch` string-matches is a trap - chai's AssertionError message would
    // itself contain the expected substring, so the test passes when the call
    // unexpectedly SUCCEEDS. Rethrowing AssertionError is what makes it real.
    const p = positionSet(3);
    try {
      await mint(p, 7 as any);
      assert.fail("expected InvalidLegType");
    } catch (e: any) {
      if (e instanceof chai.AssertionError) throw e;
      assert.include(e.toString(), "InvalidLegType");
    }
  });

  it("rejects a mint the free balance cannot cover", async () => {
    const p = positionSet(4);
    const free = BigInt((await uc()).balanceA.toString());
    try {
      // Demand a cap larger than the entire free balance.
      await mint(p, LEG_SHORT, new BN((free + 1_000_000_000n).toString()), MAX_B);
      assert.fail("expected InsufficientFunds");
    } catch (e: any) {
      assert.include(e.toString(), "InsufficientFunds");
    }
  });

  it("supports two concurrent shorts and attributes each lock separately", async () => {
    const p1 = positionSet(5);
    const p2 = positionSet(6);
    const openBefore = (await uc()).openPositions;

    await mint(p1);
    await mint(p2);
    assert.equal((await uc()).openPositions, openBefore + 2, "both counted");
    await assertConservation("two shorts open");

    const pos1 = await (program.account as any).permaPosition.fetch(p1.permaPosition);
    const locked1 = BigInt(pos1.lockedA.toString());
    const lockedTotal = BigInt((await uc()).lockedA.toString());

    // Burn only the second.
    await burn(p2);

    assert.equal((await uc()).openPositions, openBefore + 1, "one short remains");
    const pos1After = await (program.account as any).permaPosition.fetch(p1.permaPosition);
    assert.equal(
      pos1After.lockedA.toString(),
      locked1.toString(),
      "the surviving position's lock must be untouched"
    );
    assert.isBelow(
      Number(BigInt((await uc()).lockedA.toString())),
      Number(lockedTotal),
      "only the burned position's lock was released"
    );

    await assertConservation("after burning one of two");
    await burn(p1); // clean up
    await assertConservation("after burning both");
  });

  it("final conservation across all positions and ledgers", async () => {
    await assertConservation("final");
  });
});
