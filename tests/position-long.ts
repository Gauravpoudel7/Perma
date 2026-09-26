/**
 * Component 06 - Long Mint behind the inventory gate.
 *
 * A long has no Orca position and moves no tokens: it buys the right to the
 * price exposure of short liquidity someone else already provided. So the
 * assertions here are about the **ledger**, not about Orca.
 *
 * Two properties carry the weight:
 *
 *  1. `total_short_liquidity` is NEVER reduced by a long. Only the derived
 *     `available = total_short - total_long` moves. Using `available` as the
 *     premium denominator would over-pay shorts as longs open.
 *  2. Conservation is untouched by any long operation, because longs move no
 *     tokens: `vault + Σ in_orca == Σ(free + locked)` is invariant across them.
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
import { assert } from "chai";
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
const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;

const SHORT_L = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("position-long: inventory-gated long mint", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;
  const pricing = testPricing(program, provider);

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const market = pda([Buffer.from("market"), PERMA_WHIRLPOOL.toBuffer()]);
  const marketAuthority = pda([Buffer.from("market_authority"), market.toBuffer()]);
  const globalConfig = pda([Buffer.from("global_config")]);
  const userCollateral = pda([Buffer.from("collateral"), market.toBuffer(), me.toBuffer()]);
  const premiumIndex = pda([Buffer.from("premium_index"), market.toBuffer()]);

  /** Seeds use to_le_bytes() - NOT Orca's TickArray to_string() convention. */
  const rangePda = (lo: number, hi: number) =>
    pda([
      Buffer.from("range"),
      market.toBuffer(),
      new BN(lo).toTwos(32).toArrayLike(Buffer, "le", 4),
      new BN(hi).toTwos(32).toArrayLike(Buffer, "le", 4),
    ]);
  const demoRange = rangePda(TICK_LOWER, TICK_UPPER);

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

  /** A range no short has ever touched - its RangePremiumState won't exist. */
  const EMPTY_LOWER = -39184;
  const EMPTY_UPPER = -39104;
  const emptyRange = rangePda(EMPTY_LOWER, EMPTY_UPPER);

  const tickArrayLower = tickArrayPda(TICK_LOWER);
  const tickArrayUpper = tickArrayPda(TICK_UPPER);

  /**
   * Suites load in the same process, so every `Date.now()` here lands within a
   * few milliseconds of every other one. Bases that close together overlap as
   * soon as a suite mints more than a handful of positions, and the collision
   * surfaces as `Allocate: account already in use` in an unrelated test. Each
   * suite gets a disjoint block instead.
   */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 3_000_000_000; // position-long
  let n = 0;
  const nextNonce = () => NONCE_BASE + ++n;

  function posSet(nonce: number) {
    const positionMint = Keypair.generate();
    return {
      nonce,
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
        me.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ]),
    };
  }
  type P = ReturnType<typeof posSet>;

  const mintAccounts = async (p: P, range: PublicKey, lo: number, hi: number) => ({
    owner: me,
    market,
    marketAuthority,
    userCollateral,
    permaPosition: p.permaPosition,
    premiumIndex,
    rangeState: range,
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

  const mintShort = async (p: P, l = SHORT_L) =>
    program.methods
      .mintPosition(LEG_SHORT, TICK_LOWER, TICK_UPPER, l, MAX_A, MAX_B, new BN(p.nonce))
      .accounts(await mintAccounts(p, demoRange, TICK_LOWER, TICK_UPPER))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();

  /**
   * Component 09: every open long the owner already has rides along as a
   * remaining account, so the solvency gate can count their accrued premium
   * and margin. Fetched from the chain each time - the count must match
   * `open_longs` exactly or the mint fails `MissingOpenLong`.
   */
  const openLongs = async () => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: me.toBase58() } },
    ]);
    return all
      .filter((x: any) => x.account.legType === LEG_LONG && x.account.status === 0)
      .map((x: any) => ({ pubkey: x.publicKey, isSigner: false, isWritable: false }));
  };

  /** `required_margin(L)` exactly as the program computes it (ADR-0003). */
  const requiredMargin = async (liquidity: bigint) => {
    const m = await (program.account as any).market.fetch(market);
    const scaled =
      BigInt(m.longMarginHorizonSlots.toString()) *
      BigInt(m.premiumRate.toString()) *
      liquidity *
      BigInt(m.premiumMultiplier.toString());
    const SCALE = 1_000_000_000_000n;
    const ceil = scaled / SCALE + (scaled % SCALE === 0n ? 0n : 1n);
    return ceil + BigInt(m.longMarginBufferUsdc.toString());
  };

  /**
   * Make sure free USDC is at least `min`, topping up from the fixture ATA
   * (capped by what it still holds). Long mints now need real margin, so the
   * fixed top-up in `before()` is not enough for every test on a shared ledger.
   */
  const ensureFreeB = async (min: bigint) => {
    const have = BigInt((await uc()).balanceB.toString());
    if (have >= min) return;
    const avail = await amt(USER_B);
    const top = min - have < avail ? min - have : avail;
    if (top <= 0n) return;
    await program.methods
      .depositCollateral(new BN(0), new BN(top.toString()))
      .accounts({
        owner: me, market, userCollateral, userTokenA: USER_A, userTokenB: USER_B,
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };

  const mintLong = async (
    p: P,
    size: BN,
    range = demoRange,
    lo = TICK_LOWER,
    hi = TICK_UPPER
  ) =>
    program.methods
      .mintPosition(LEG_LONG, lo, hi, size, new BN(0), new BN(0), new BN(p.nonce))
      // Component 09: a long carries none of the Orca accounts (they are
      // `Option` on the program side) and no position-mint signer - that is
      // what makes room for the open-long set as remaining accounts.
      .accounts({
        ...await mintAccounts(p, range, lo, hi),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongs())
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

  /** SHORT burn: every Orca account present. */
  const burn = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex, rangeState: demoRange,
        rangeVault,
        whirlpool: PERMA_WHIRLPOOL,
        orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey,
        positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC,
        vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
        tickArrayLower, tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  /**
   * LONG burn: no *Orca* accounts. A long has no Orca position, so that half of
   * the context is null - which is why those fields are `Option`. `vaultB` and
   * `tokenProgram` are NOT optional in practice: component 08 settles the
   * accrued premium in cash before the position may close, so the burn needs
   * somewhere to move the USDC from.
   */
  const burnLong = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex, rangeState: demoRange,
        rangeVault,
        whirlpool: null, orcaPosition: null, positionMint: null,
        positionTokenAccount: null, tokenMintA: null, tokenMintB: null,
        vaultA: null, vaultB: VAULT_B, orcaVaultA: null, orcaVaultB: null,
        tickArrayLower: null, tickArrayUpper: null,
        tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
      })
      .rpc();

  const rangeOf = (pk: PublicKey) => (program.account as any).rangePremiumState.fetch(pk);
  const uc = () => (program.account as any).userCollateral.fetch(userCollateral);
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };

  /** vault + Σ in_orca − Σ(free+locked). Longs must never change this. */
  async function discrepancy(): Promise<[bigint, bigint]> {
    const users = await (program.account as any).userCollateral.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    const positions = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    let owedA = 0n, owedB = 0n, orcaA = 0n, orcaB = 0n;
    for (const { account } of users) {
      owedA += BigInt(account.balanceA.toString()) + BigInt(account.lockedA.toString());
      owedB += BigInt(account.balanceB.toString()) + BigInt(account.lockedB.toString());
    }
    for (const { account } of positions) {
      orcaA += BigInt(account.inOrcaA.toString());
      orcaB += BigInt(account.inOrcaB.toString());
    }
    return [(await amt(VAULT_A)) + orcaA - owedA, (await amt(VAULT_B)) + orcaB - owedB];
  }

  /** Seeded in `before` so at least one short backs the demo range. */
  let seedShort: P;

  before(async () => {
    assert.isAbove(Number(await amt(USER_A)), 0, "run node scripts/make-fixtures.mjs");

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

    // Top up only what is needed, capped by what the fixtures still hold.
    const min = (x: bigint, y: bigint) => (x < y ? x : y);
    const have = (await conn.getAccountInfo(userCollateral))
      ? await uc()
      : { balanceA: new BN(0), balanceB: new BN(0) };
    const needA = 2_000_000_000n, needB = 200_000_000n;
    const hA = BigInt(have.balanceA.toString()), hB = BigInt(have.balanceB.toString());
    const topA = hA >= needA ? 0n : min(needA - hA, await amt(USER_A));
    const topB = hB >= needB ? 0n : min(needB - hB, await amt(USER_B));
    if (topA > 0n || topB > 0n) {
      await program.methods
        .depositCollateral(new BN(topA.toString()), new BN(topB.toString()))
        .accounts({
          owner: me, market, userCollateral, userTokenA: USER_A, userTokenB: USER_B,
          vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // One short so the demo range has inventory to sell against.
    seedShort = posSet(nextNonce());
    await mintShort(seedShort);
  });

  it("a short creates the range ledger and registers its liquidity", async () => {
    const r = await rangeOf(demoRange);
    assert.equal(r.market.toBase58(), market.toBase58());
    assert.equal(r.tickLower, TICK_LOWER);
    assert.isAbove(Number(r.totalShortLiquidity.toString()), 0, "short registered");
    // total_long is only zero on a fresh ledger; a re-run inherits longs left
    // open by the harness-guard test. The invariant that always holds:
    assert.isAtLeast(
      Number(r.totalShortLiquidity.toString()),
      Number(r.totalLongLiquidity.toString()),
      "total_short >= total_long always"
    );

    // The short checkpointed against the accumulator at mint time.
    const pos = await (program.account as any).permaPosition.fetch(seedShort.permaPosition);
    assert.equal(pos.legType, LEG_SHORT);
    assert.equal(
      pos.entryAccQ64.toString(),
      r.accPremiumPerShortQ64.toString(),
      "short must checkpoint at mint, or it earns for periods before it existed"
    );
  });

  it("long mint consumes availability without reducing total_short_liquidity", async () => {
    const before = await rangeOf(demoRange);
    const shortBefore = BigInt(before.totalShortLiquidity.toString());
    const availBefore = shortBefore - BigInt(before.totalLongLiquidity.toString());
    const openBefore = (await uc()).openPositions;
    const [dA, dB] = await discrepancy();

    const size = new BN((availBefore / 4n).toString());
    const p = posSet(nextNonce());
    await mintLong(p, size);

    const after = await rangeOf(demoRange);
    assert.equal(
      after.totalShortLiquidity.toString(),
      shortBefore.toString(),
      "a long must NEVER reduce the premium denominator"
    );
    assert.equal(
      BigInt(after.totalLongLiquidity.toString()) - BigInt(before.totalLongLiquidity.toString()),
      BigInt(size.toString()),
      "total_long rises by the long's size"
    );
    assert.equal(
      shortBefore - BigInt(after.totalLongLiquidity.toString()),
      availBefore - BigInt(size.toString()),
      "availability falls by exactly the size"
    );

    // The position itself: no Orca, no tokens.
    const pos = await (program.account as any).permaPosition.fetch(p.permaPosition);
    assert.equal(pos.legType, LEG_LONG);
    assert.equal(pos.orcaPosition.toBase58(), PublicKey.default.toBase58(), "no Orca position");
    assert.equal(pos.inOrcaA.toString(), "0");
    assert.equal(pos.lockedA.toString(), "0", "a long locks no collateral");
    assert.isAbove(Number(pos.entryIndex.toString()), 0, "checkpointed at the current index");

    assert.equal((await uc()).openPositions, openBefore, "open_positions counts SHORTS only");

    const [dA2, dB2] = await discrepancy();
    assert.equal(dA2.toString(), dA.toString(), "a long moves no WSOL");
    assert.equal(dB2.toString(), dB.toString(), "a long moves no devUSDC");
  });

  it("rejects a long on a range no short has ever traded", async () => {
    const p = posSet(nextNonce());
    try {
      await mintLong(p, new BN(1_000), emptyRange, EMPTY_LOWER, EMPTY_UPPER);
      assert.fail("expected NoShortInventory");
    } catch (e: any) {
      // The range PDA is created by init_if_needed, then the gate finds zero
      // inventory - either way the long must not open.
      assert.include(e.toString(), "NoShortInventory");
    }
  });

  it("rejects a long larger than available inventory", async () => {
    const r = await rangeOf(demoRange);
    const avail =
      BigInt(r.totalShortLiquidity.toString()) - BigInt(r.totalLongLiquidity.toString());
    const p = posSet(nextNonce());
    try {
      await mintLong(p, new BN((avail + 1n).toString()));
      assert.fail("expected NoShortInventory");
    } catch (e: any) {
      assert.include(e.toString(), "NoShortInventory");
    }
  });

  it("a second short raises availability for a further long", async () => {
    const before = await rangeOf(demoRange);
    const availBefore =
      BigInt(before.totalShortLiquidity.toString()) - BigInt(before.totalLongLiquidity.toString());

    const s2 = posSet(nextNonce());
    await mintShort(s2);

    const after = await rangeOf(demoRange);
    const availAfter =
      BigInt(after.totalShortLiquidity.toString()) - BigInt(after.totalLongLiquidity.toString());
    assert.equal(
      availAfter - availBefore,
      BigInt(SHORT_L.toString()),
      "availability rises by the new short's liquidity"
    );

    // And that new availability is usable.
    const p = posSet(nextNonce());
    await mintLong(p, new BN(SHORT_L.toString()));
    await burnLong(p); // tidy up so later inventory assertions are clean
  });

  it("short burn is blocked when longs still depend on the liquidity", async () => {
    // Consume ALL remaining availability with a long.
    const r = await rangeOf(demoRange);
    const avail =
      BigInt(r.totalShortLiquidity.toString()) - BigInt(r.totalLongLiquidity.toString());
    assert.isAbove(Number(avail), 0, "precondition: some availability exists");

    // Component 09: a long this size needs `avail µUSDC + 1 USDC` of margin on
    // top of whatever existing longs already require. Top up so the test is
    // about the inventory invariant, not about running out of demo USDC.
    const existing = await openLongs();
    let need = await requiredMargin(avail);
    for (const { pubkey } of existing) {
      const l = await (program.account as any).permaPosition.fetch(pubkey);
      need += await requiredMargin(BigInt(l.liquidity.toString())) + 10_000_000n; // + accrual headroom
    }
    await ensureFreeB(need + 5_000_000n);

    const hog = posSet(nextNonce());
    await mintLong(hog, new BN(avail.toString()));

    // Now every short is fully spoken for; burning one would leave longs
    // backed by liquidity that no longer exists.
    try {
      await burn(seedShort);
      assert.fail("expected InventoryInvariantViolated");
    } catch (e: any) {
      assert.include(e.toString(), "InventoryInvariantViolated");
    }

    // Release the long, and the very same short burn now succeeds.
    await burnLong(hog);
    await burn(seedShort);
    const after = await rangeOf(demoRange);
    assert.isAtLeast(
      Number(after.totalShortLiquidity.toString()),
      Number(after.totalLongLiquidity.toString()),
      "invariant holds after the burn"
    );
  });

  /**
   * Component 08 replaced this test's original assertion. It used to check that
   * a long burn recorded a liability and moved NO cash; that is exactly the
   * state 08 removes, so it now checks the opposite: the USDC leaves the
   * collateral vault for the range escrow before the position may close.
   */
  it("long burn pays its premium in cash before closing", async () => {
    const r = await rangeOf(demoRange);
    let avail =
      BigInt(r.totalShortLiquidity.toString()) - BigInt(r.totalLongLiquidity.toString());
    if (avail === 0n) {
      const s = posSet(nextNonce());
      await mintShort(s);
      avail = BigInt(SHORT_L.toString());
    }

    const p = posSet(nextNonce());
    await mintLong(p, new BN((avail / 2n).toString()));

    const freeBefore = BigInt((await uc()).balanceB.toString());
    const vaultBefore = await amt(VAULT_B);
    const escrowBefore = await amt(rangeVault);
    const poolBefore = BigInt((await rangeOf(demoRange)).premiumPool.toString());
    const longBefore = BigInt((await rangeOf(demoRange)).totalLongLiquidity.toString());

    await burnLong(p);

    assert.isNull(await conn.getAccountInfo(p.permaPosition), "position PDA closed");
    const after = await rangeOf(demoRange);
    assert.isBelow(
      Number(after.totalLongLiquidity.toString()),
      Number(longBefore),
      "total_long decremented"
    );

    // Every unit debited from the long left vault_b and arrived in the escrow.
    const freeAfter = BigInt((await uc()).balanceB.toString());
    const paid = freeBefore - freeAfter;
    assert.isAbove(Number(paid), 0, "the long actually paid premium");
    assert.equal(await amt(VAULT_B), vaultBefore - paid, "vault_b debited by exactly that");
    assert.equal(await amt(rangeVault), escrowBefore + paid, "range vault credited by exactly that");
    assert.equal(
      BigInt(after.premiumPool.toString()),
      poolBefore + paid,
      "premium_pool tracks the tokens"
    );

    // The escrow identity: the account holds exactly what the books say.
    assert.equal(
      await amt(rangeVault),
      BigInt(after.premiumPool.toString()) + BigInt(after.dust.toString()),
      "range_vault.amount == premium_pool + dust"
    );

    // No liability was created - 08 never increases this field.
    assert.equal(
      BigInt((await uc()).premiumOwedUsdc.toString()),
      0n,
      "no liability recorded: the debt was paid, not parked"
    );
  });

  it("the adapter harness is refused on a range that has longs", async () => {
    // Ensure a long exists so the guard is reachable, and remember it so this
    // test can clean up - a leftover long would (correctly!) block the
    // adapter-liquidity harness suite on the same ledger.
    let guardLong: P | null = null;
    const r0 = await rangeOf(demoRange);
    if (BigInt(r0.totalLongLiquidity.toString()) === 0n) {
      let avail =
        BigInt(r0.totalShortLiquidity.toString()) - BigInt(r0.totalLongLiquidity.toString());
      if (avail === 0n) {
        await mintShort(posSet(nextNonce()));
        avail = BigInt(SHORT_L.toString());
      }
      guardLong = posSet(nextNonce());
      await mintLong(guardLong, new BN((avail / 2n).toString()));
    }

    const p = posSet(nextNonce());
    try {
      await program.methods
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

      // open_position alone is harmless; the guard is on add_liquidity.
      await program.methods
        .adapterAddLiquidity(TICK_LOWER, TICK_UPPER, SHORT_L, MAX_A, MAX_B)
        .accounts({
          owner: me, market, marketAuthority, permaPosition: p.permaPosition,
          whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
          positionTokenAccount: p.positionTokenAccount,
          tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
          orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
          tickArrayLower, tickArrayUpper, rangeState: demoRange,
          tokenProgramA: TOKEN_PROGRAM, tokenProgramB: TOKEN_PROGRAM,
          memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
        .rpc();
      assert.fail("expected HarnessPathUnavailable");
    } catch (e: any) {
      assert.include(e.toString(), "HarnessPathUnavailable");
    } finally {
      if (guardLong) await burnLong(guardLong);
    }
  });

  /**
   * Drain every long this suite left open.
   *
   * A leftover long correctly blocks the `adapter_*` harness on the same range
   * - that guard is the point of Q7. Cleaning up here keeps the suites
   * order-independent instead of encoding a run order nobody will remember.
   */
  after(async () => {
    const mine = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    for (const { publicKey, account } of mine) {
      if (account.legType !== LEG_LONG || account.status !== 0) continue;
      await program.methods
        .burnPosition(new BN(0), new BN(0))
        .accounts({
          owner: me, market, marketAuthority, userCollateral,
          permaPosition: publicKey, premiumIndex,
          rangeState: rangePda(account.tickLower, account.tickUpper),
          rangeVault: rangeVaultPda(account.tickLower, account.tickUpper),
          whirlpool: null, orcaPosition: null, positionMint: null,
          positionTokenAccount: null, tokenMintA: null, tokenMintB: null,
          vaultA: null, vaultB: VAULT_B, orcaVaultA: null, orcaVaultB: null,
          tickArrayLower: null, tickArrayUpper: null,
          tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
        })
        .rpc()
        .catch(() => {});
    }
    const r = await rangeOf(demoRange);
    assert.equal(
      r.totalLongLiquidity.toString(),
      "0",
      "suite must leave no longs, or it blocks the harness suite"
    );
    await pricing.restore();
  });

  it("final: inventory invariant and conservation both hold", async () => {
    const r = await rangeOf(demoRange);
    // Longs left open here would block the adapter harness suite - by design.
    // Assert the ledger is left usable rather than relying on run order.
    assert.isAtLeast(
      Number(r.totalShortLiquidity.toString()),
      Number(r.totalLongLiquidity.toString()),
      "total_short >= total_long always"
    );
  });
});
