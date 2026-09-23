/**
 * P1 - `unwind_empty_range`: sweeping the rounding residue out of a range that
 * nobody is in any more, and closing both of its accounts.
 *
 * `ADR-0002` and `08-burn-settle.md` §F specified this from the start: premium
 * is split by a floored Q64.64 accumulator, so a range that has paid every
 * short in full still holds a µUSDC or two that belongs to nobody. Until now
 * there was no instruction able to move it, and `RangePremiumState` +
 * `range_vault` stayed rent-funded forever.
 *
 * This suite runs a whole life cycle on its own tick range - the narrow
 * same-array case from `FIXTURES-AND-VECTORS.md` §6, distinct from the demo
 * range every other suite shares - so it can reach a genuinely empty range
 * without waiting on anyone else's positions.
 *
 * The short's liquidity is deliberately **odd**: `(inflow << 64) / L` is exact
 * only when `L` divides `inflow << 64`, and an odd `L` larger than any inflow
 * here never does. That makes the residue exactly 1 µUSDC rather than
 * "probably something", so the sweep has real money to move on every run.
 *
 * Order-independence: the range is this suite's alone, `before()` heals a range
 * a crashed run left populated, and `after()` burns anything still open.
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
} from "@solana/web3.js";
import { assert, AssertionError } from "chai";
import { freshPrice } from "./oracle-mock";

/**
 * Every send in this suite confirms at `confirmed`, and so does every
 * simulation. The provider's default is `processed`, which is *ahead* of
 * `confirmed`: mixing the two lets a preflight run against a bank that has not
 * yet seen the transaction before it, which shows up as a phantom
 * `AccountNotInitialized` or `RangeNotEmpty`. One commitment, no races.
 */
const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

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
/** `FIXTURES-AND-VECTORS.md:190` - narrow, same tick array (start -39424). */
const TICK_LOWER = -39184;
const TICK_UPPER = -39104;
/** Odd, so the Q64.64 split always leaves a residue. See the header. */
const SHORT_L = new BN(100_000_001);
const LONG_SIZE = new BN(1_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

const USDC = (n: number) => BigInt(n) * 1_000_000n;

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("range-unwind: empty-range residue sweep (P1)", () => {
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
  const myRange = rangePda(TICK_LOWER, TICK_UPPER);
  const myVault = rangeVaultPda(TICK_LOWER, TICK_UPPER);
  const tickArrayLower = tickArrayPda(TICK_LOWER);
  const tickArrayUpper = tickArrayPda(TICK_UPPER);

  /** Disjoint nonce block - see settle-premium.ts for why. */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 9_000_000_000; // range-unwind
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

  /** Not the admin: signs to earn `Unauthorized`. */
  const stranger = Keypair.generate();

  const mintAccounts = async (p: P) => ({
    owner: p.owner,
    market,
    marketAuthority,
    userCollateral: collateralOf(p.owner),
    permaPosition: p.permaPosition,
    premiumIndex,
    rangeState: myRange,
    rangeVault: myVault,
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
      .accounts(await mintAccounts(p))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc(CONFIRMED);

  const mintLong = async (p: P, size: BN) =>
    program.methods
      .mintPosition(LEG_LONG, TICK_LOWER, TICK_UPPER, size, new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongsOf(p.owner))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc(CONFIRMED);

  const burnShort = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: myRange, rangeVault: myVault,
        whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey, positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B, tickArrayLower, tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc(CONFIRMED);

  const burnLong = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: p.owner, market, marketAuthority, userCollateral: collateralOf(p.owner),
        permaPosition: p.permaPosition, premiumIndex, rangeState: myRange, rangeVault: myVault,
        whirlpool: null, orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: VAULT_B,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
      })
      .rpc(CONFIRMED);

  const deposit = (a: bigint, b: bigint) =>
    program.methods
      .depositCollateral(new BN(a.toString()), new BN(b.toString()))
      .accounts({
        owner: me, market, userCollateral: collateralOf(me),
        userTokenA: USER_A, userTokenB: USER_B,
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .rpc(CONFIRMED);

  const unwind = (
    admin: PublicKey = me,
    signers: Keypair[] = [],
    rangeState: PublicKey = myRange,
    rangeVault: PublicKey = myVault,
    destination: PublicKey = USER_B
  ) =>
    program.methods
      .unwindEmptyRange()
      .accounts({
        admin, globalConfig, market, marketAuthority,
        rangeState, rangeVault, destination, tokenProgram: TOKEN_PROGRAM,
      })
      .signers(signers)
      .rpc(CONFIRMED);

  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const uc = async () => (program.account as any).userCollateral.fetch(collateralOf(me));
  const rangeOf = () => (program.account as any).rangePremiumState.fetch(myRange);
  const expectErr = async (p: Promise<unknown>, name: string) => {
    try {
      await p;
      assert.fail(`expected ${name}`);
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), name);
    }
  };
  const waitSlots = async (k: number) => {
    const from = await conn.getSlot("confirmed");
    while ((await conn.getSlot("confirmed")) < from + k) await new Promise((r) => setTimeout(r, 400));
  };

  const parser = new EventParser(program.programId, program.coder);
  const eventsOf = async (sig: string) => {
    for (let i = 0; i < 20; i++) {
      const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx?.meta?.logMessages) return [...parser.parseLogs(tx.meta.logMessages)];
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`tx ${sig} never became visible at confirmed`);
  };

  /**
   * Refill free collateral to comfortably above `MAX_A` / `MAX_B`. Called
   * before every short mint, not only once: the premium the long pays and the
   * residue the sweep removes both leave the free balance a few µUSDC lower
   * than the run before, which is enough to trip the mint's own check.
   */
  const topUp = async () => {
    const have = (await conn.getAccountInfo(collateralOf(me)))
      ? await uc()
      : { balanceA: new BN(0), balanceB: new BN(0) };
    const wantA = 2_000_000_000n - BigInt(have.balanceA.toString());
    if (wantA > 0n) {
      const cap = await amt(USER_A);
      await deposit(wantA < cap ? wantA : cap, 0n);
    }
    const wantB = USDC(150) - BigInt(have.balanceB.toString());
    if (wantB > 0n) {
      const cap = await amt(USER_B);
      await deposit(0n, wantB < cap ? wantB : cap);
    }
  };

  /** Everything this suite opens, so `after()` can close it whatever happened. */
  const openShorts: P[] = [];
  const openLongs: P[] = [];
  let theShort: P;
  let theLong: P;

  before(async () => {
    assert.isAbove(Number(await amt(USER_B)), 0, "run node scripts/make-fixtures.mjs");
    if ((await conn.getAccountInfo(globalConfig)) === null) {
      await program.methods
        .initializeGlobalConfig(PERMA_WHIRLPOOL)
        .accounts({ admin: me, globalConfig, systemProgram: SystemProgram.programId })
        .rpc(CONFIRMED);
    }
    if ((await conn.getAccountInfo(market)) === null) {
      await program.methods
        .createMarket()
        .accounts({
          admin: me, globalConfig, market, marketAuthority,
          whirlpool: PERMA_WHIRLPOOL, vaultA: VAULT_A, vaultB: VAULT_B,
          whirlpoolProgram: WHIRLPOOL_PROGRAM, systemProgram: SystemProgram.programId,
        })
        .rpc(CONFIRMED);
    }
    if ((await marketState()).isPaused) {
      await program.methods.unpauseMarket().accounts({ admin: me, globalConfig, market }).rpc(CONFIRMED);
    }
    await conn.confirmTransaction(
      await conn.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );

    // A crashed earlier run may have left OUR range populated. Burn whatever
    // of ours is still open in it before starting the life cycle over.
    await healRange();

    await topUp();

    theShort = posSet(nextNonce());
    await mintShort(theShort);
    openShorts.push(theShort);
    theLong = posSet(nextNonce());
    await mintLong(theLong, LONG_SIZE);
    openLongs.push(theLong);
  });

  const marketState = () => (program.account as any).market.fetch(market);

  /** Close every position this wallet still holds in THIS range. */
  async function healRange() {
    if ((await conn.getAccountInfo(myRange)) === null) return;
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: me.toBase58() } },
    ]);
    const mine = all.filter(
      (x: any) =>
        x.account.status === STATUS_OPEN &&
        x.account.tickLower === TICK_LOWER &&
        x.account.tickUpper === TICK_UPPER
    );
    // Longs first: a short may not leave while longs still lean on it.
    for (const x of mine.filter((y: any) => y.account.legType === LEG_LONG)) {
      await burnLong({ ...posSet(Number(x.account.nonce)), permaPosition: x.publicKey }).catch(() => {});
    }
    for (const x of mine.filter((y: any) => y.account.legType === LEG_SHORT)) {
      const p = posSet(Number(x.account.nonce));
      await burnShort({
        ...p,
        permaPosition: x.publicKey,
        orcaPosition: x.account.orcaPosition,
        positionMint: { publicKey: x.account.positionMint } as any,
        positionTokenAccount: PublicKey.findProgramAddressSync(
          [marketAuthority.toBuffer(), TOKEN_PROGRAM.toBuffer(), x.account.positionMint.toBuffer()],
          ATA_PROGRAM
        )[0],
      }).catch(() => {});
    }
  }

  it("refuses a range that still has inventory", async () => {
    const r = await rangeOf();
    assert.notEqual(r.totalShortLiquidity.toString(), "0", "the short is still open");
    await expectErr(unwind(), "RangeNotEmpty");
  });

  it("only the admin may unwind", async () => {
    await expectErr(unwind(stranger.publicKey, [stranger]), "Unauthorized");
  });

  describe("once the range is empty", () => {
    let pool: bigint;

    before(async () => {
      // Let the long accrue, then close both legs. Burning the long pays its
      // whole accrual into the range vault; burning the short claims against
      // that cash while it is still inside `total_short_liquidity`.
      await waitSlots(20);
      await burnLong(theLong);
      openLongs.length = 0;
      await burnShort(theShort);
      openShorts.length = 0;

      const r = await rangeOf();
      assert.equal(r.totalShortLiquidity.toString(), "0");
      assert.equal(r.totalLongLiquidity.toString(), "0");
      assert.equal(r.receivable.toString(), "0", "no short is still owed anything");
      pool = BigInt(r.premiumPool.toString());
      assert.isAbove(Number(pool), 0, "the floored split must have left a residue to sweep");
      assert.equal((await amt(myVault)).toString(), (pool + BigInt(r.dust.toString())).toString());
    });

    it("sweeps the residue to the admin and closes both accounts", async () => {
      const before = await amt(USER_B);
      const sig = await unwind();
      assert.equal((await amt(USER_B)) - before, pool, "destination receives exactly the residue");
      assert.isNull(await conn.getAccountInfo(myVault), "range_vault is closed");
      assert.isNull(await conn.getAccountInfo(myRange), "range_state is closed");

      const hits = (await eventsOf(sig)).filter(
        (e) => e.name === "rangeUnwound"
      );
      assert.equal(hits.length, 1);
      const d = (hits[0] as any).data;
      assert.isTrue(d.market.equals(market));
      assert.isTrue(d.admin.equals(me));
      assert.equal(d.tickLower, TICK_LOWER);
      assert.equal(d.tickUpper, TICK_UPPER);
      assert.equal(d.amountUsdc.toString(), pool.toString());
    });

    it("a second unwind has nothing left to close", async () => {
      await expectErr(unwind(), "AccountNotInitialized");
    });

    it("the range can be re-created by a plain mint afterwards", async () => {
      // `init_if_needed` + a `last_index` of 0 that `poke_range` ignores until
      // both sides are live: a re-created range behaves like a brand-new one.
      await topUp();
      const p = posSet(nextNonce());
      await mintShort(p);
      openShorts.push(p);
      const r = await rangeOf();
      assert.equal(r.totalShortLiquidity.toString(), SHORT_L.toString());
      assert.equal(r.premiumPool.toString(), "0");
    });
  });

  after(async () => {
    const note = (what: string) => (e: any) => console.log(`      cleanup: ${what} failed: ${e.message ?? e}`);
    for (const p of openLongs) await burnLong(p).catch(note("burnLong"));
    for (const p of openShorts) await burnShort(p).catch(note("burnShort"));
    await healRange();
    const info = await conn.getAccountInfo(myRange);
    if (info) {
      const r = await rangeOf();
      assert.equal(r.totalShortLiquidity.toString(), "0", "suite must leave its range empty");
      assert.equal(r.totalLongLiquidity.toString(), "0");
    }
  });
});
