/**
 * Protocol V1 P3 - oracle gate on `mint_position` (ADR-0004).
 *
 * New exposure (SHORT or LONG) opens only when a Full-verified Pyth SOL/USD
 * `PriceUpdateV2` is fresh, confident, and within `MAX_DEVIATION_BPS` of the
 * Whirlpool spot. Exits (burn, withdraw, settle) never read it.
 *
 * Localnet: the mock receiver sits at the real receiver address
 * (scripts/local-validator.sh), so these tests drive the reference side. The
 * cloned pool's spot cannot be moved cheaply, which is why the spot-spike
 * vector moves the reference instead - the check only sees the gap.
 *
 * Every unhealthy price lives on its own tag, so tag 0 (the healthy feed the
 * other suites use) is only ever touched by the pause vector, which re-heals it.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { readdirSync, readFileSync } from "fs";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { assert, AssertionError } from "chai";
import { freshPrice, invalidateFresh, poolSpotE8, setPrice } from "./oracle-mock";

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

/** `oracle.rs` policy (ADR-0004); the boundaries themselves are unit-tested there. */
const MAX_STALENESS_SECS = 60;
const MAX_CONF_BPS = 100n;
const MAX_DEVIATION_BPS = 200n;

/** One tag per unhealthy reference; tag 0 is the shared healthy feed. */
const TAG = { stale: 1, conf: 2, above: 3, below: 4, spike: 5, feed: 6, partial: 7 };

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("oracle-risk: fail-closed reference gate on mint (P3, ADR-0004)", () => {
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
  const userCollateral = pda([Buffer.from("collateral"), market.toBuffer(), me.toBuffer()]);
  const demoRange = pda([Buffer.from("range"), market.toBuffer(), i32le(TICK_LOWER), i32le(TICK_UPPER)]);
  const demoVault = pda([Buffer.from("range_vault"), market.toBuffer(), i32le(TICK_LOWER), i32le(TICK_UPPER)]);

  /** Disjoint nonce block - see settle-premium.ts for why. */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 8_000_000_000; // oracle-risk
  let n = 0;

  function posSet() {
    const nonce = NONCE_BASE + ++n;
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

  const mintAccounts = (p: P, priceUpdate: PublicKey) => ({
    owner: me,
    market,
    marketAuthority,
    userCollateral,
    permaPosition: p.permaPosition,
    premiumIndex,
    rangeState: demoRange,
    rangeVault: demoVault,
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
    tickArrayLower: tickArrayPda(TICK_LOWER),
    tickArrayUpper: tickArrayPda(TICK_UPPER),
    tokenProgram: TOKEN_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    memoProgram: MEMO_PROGRAM,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    priceUpdate,
  });

  const openLongs = async () => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: me.toBase58() } },
    ]);
    return all
      .filter((x: any) => x.account.legType === LEG_LONG && x.account.status === STATUS_OPEN)
      .map((x: any) => ({ pubkey: x.publicKey, isSigner: false, isWritable: false }));
  };

  const mintShort = (p: P, priceUpdate: PublicKey) =>
    program.methods
      .mintPosition(LEG_SHORT, TICK_LOWER, TICK_UPPER, SHORT_L, MAX_A, MAX_B, new BN(p.nonce))
      .accounts(mintAccounts(p, priceUpdate))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();

  /** `whirlpool` is the one Orca account a long carries since ADR-0004 (spot read). */
  const mintLong = async (p: P, priceUpdate: PublicKey, whirlpool: PublicKey | null = PERMA_WHIRLPOOL) =>
    program.methods
      .mintPosition(LEG_LONG, TICK_LOWER, TICK_UPPER, new BN(1_000_000), new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...mintAccounts(p, priceUpdate),
        whirlpool, orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongs())
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

  const burnShort = (p: P) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex, rangeState: demoRange, rangeVault: demoVault,
        whirlpool: PERMA_WHIRLPOOL, orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey, positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC, vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
        tickArrayLower: tickArrayPda(TICK_LOWER), tickArrayUpper: tickArrayPda(TICK_UPPER),
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM, whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  const withdraw = async (b: bigint) =>
    program.methods
      .withdrawCollateral(new BN(0), new BN(b.toString()))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        userTokenA: USER_A, userTokenB: USER_B, vaultA: VAULT_A, vaultB: VAULT_B,
        tokenProgram: TOKEN_PROGRAM, premiumIndex,
      })
      .remainingAccounts(await openLongs())
      .rpc();

  const adminAccounts = { admin: me, globalConfig, market };
  const isPaused = async () => (await (program.account as any).market.fetch(market)).isPaused as boolean;
  const positionStatus = async (p: P) =>
    (await (program.account as any).permaPosition.fetch(p.permaPosition)).status as number;
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const expectErr = async (p: Promise<unknown>, name: string) => {
    try {
      await p;
      assert.fail(`expected ${name}`);
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), name);
    }
  };

  /** A rejected mint must leave nothing behind. */
  const expectRejected = async (p: P, mint: Promise<unknown>, name: string) => {
    await expectErr(mint, name);
    assert.isNull(await conn.getAccountInfo(p.permaPosition), "rejected mint created a position");
  };

  let spot: bigint;

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
    if (await isPaused()) await program.methods.unpauseMarket().accounts(adminAccounts).rpc();

    // Enough free WSOL/USDC for the healthy shorts, capped by the fixture ATAs.
    const u = await (program.account as any).userCollateral.fetchNullable(userCollateral);
    const fa = u ? BigInt(u.balanceA.toString()) : 0n;
    const fb = u ? BigInt(u.balanceB.toString()) : 0n;
    const min = (x: bigint, y: bigint) => (x < y ? x : y);
    const ta = fa >= 2_000_000_000n ? 0n : min(2_000_000_000n - fa, await amt(USER_A));
    const tb = fb >= 200_000_000n ? 0n : min(200_000_000n - fb, await amt(USER_B));
    if (ta > 0n || tb > 0n || !u) {
      await program.methods
        .depositCollateral(new BN(ta.toString()), new BN(tb.toString()))
        .accounts({
          owner: me, market, userCollateral, userTokenA: USER_A, userTokenB: USER_B,
          vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    spot = await poolSpotE8(provider);
    assert.isTrue(spot > 0n);
  });

  it("ORACLE_HEALTHY_OK: a fresh, confident reference at spot lets a SHORT open", async () => {
    const p = posSet();
    await mintShort(p, await freshPrice(provider));
    assert.equal(await positionStatus(p), STATUS_OPEN);
    await burnShort(p);
  });

  it("ORACLE_STALE_FAIL: a reference older than 60 s blocks both legs", async () => {
    const stale = await setPrice(provider, {
      price: spot, conf: spot / 1000n, ageSecs: MAX_STALENESS_SECS + 30, tag: TAG.stale,
    });
    const s = posSet();
    await expectRejected(s, mintShort(s, stale), "OracleStale");
    const l = posSet();
    await expectRejected(l, mintLong(l, stale), "OracleStale");
  });

  it("ORACLE_CONF_WIDE_FAIL: confidence above 1 % of price blocks the mint", async () => {
    const wide = await setPrice(provider, {
      price: spot, conf: (spot * (MAX_CONF_BPS + 1n)) / 10_000n, tag: TAG.conf,
    });
    const p = posSet();
    await expectRejected(p, mintShort(p, wide), "OracleConfidenceTooWide");
  });

  it("ORACLE_DEVIATION_FAIL: spot more than 2 % from the reference, either side", async () => {
    const off = (spot * (MAX_DEVIATION_BPS + 5n)) / 10_000n;
    const above = await setPrice(provider, { price: spot + off, conf: spot / 1000n, tag: TAG.above });
    const below = await setPrice(provider, { price: spot - off, conf: spot / 1000n, tag: TAG.below });
    const a = posSet();
    await expectRejected(a, mintShort(a, above), "OracleDeviationTooHigh");
    const b = posSet();
    await expectRejected(b, mintLong(b, below), "OracleDeviationTooHigh");
  });

  it("ORACLE_SPOT_SPIKE_FAIL: a pool pushed 50 % off the reference cannot open exposure", async () => {
    // Same check as a real in-tx spot pump: the gap is what is measured.
    const ref = await setPrice(provider, { price: (spot * 2n) / 3n, conf: spot / 1000n, tag: TAG.spike });
    const p = posSet();
    await expectRejected(p, mintShort(p, ref), "OracleDeviationTooHigh");
  });

  it("ORACLE_UNAVAILABLE_FAIL: wrong owner, wrong feed, Partial verification, no whirlpool", async () => {
    // Right bytes, wrong owner: the pool itself is not a receiver account.
    const p1 = posSet();
    await expectRejected(p1, mintShort(p1, PERMA_WHIRLPOOL), "OracleUnavailable");

    const wrongFeed = await setPrice(provider, {
      price: spot, conf: spot / 1000n, tag: TAG.feed, feed: Buffer.alloc(32, 7),
    });
    const p2 = posSet();
    await expectRejected(p2, mintShort(p2, wrongFeed), "OracleUnavailable");

    const partial = await setPrice(provider, {
      price: spot, conf: spot / 1000n, tag: TAG.partial, full: false,
    });
    const p3 = posSet();
    await expectRejected(p3, mintShort(p3, partial), "OracleUnavailable");

    // A long that omits the pool has no spot to compare: fail closed.
    const p4 = posSet();
    await expectRejected(p4, mintLong(p4, await freshPrice(provider), null), "InvalidAsset");
  });

  it("ORACLE_PAUSE_INTERACTION: paused + stale, mint refuses, exits still work", async () => {
    const p = posSet();
    await mintShort(p, await freshPrice(provider));
    await program.methods.pauseMarket().accounts(adminAccounts).rpc();
    try {
      // Make the shared feed stale too: nothing below may depend on it.
      const stale = await setPrice(provider, { price: spot, conf: spot / 1000n, ageSecs: 3_600 });
      invalidateFresh();

      const q = posSet();
      await expectRejected(q, mintShort(q, stale), "MarketPaused"); // pause wins, checked first

      await withdraw(1n); // Exit Guaranteed: no oracle account on withdraw
      await burnShort(p); // ...or on burn
      assert.isNull(await conn.getAccountInfo(p.permaPosition), "burn closes the position");
    } finally {
      await program.methods.unpauseMarket().accounts(adminAccounts).rpc();
      invalidateFresh();
      await freshPrice(provider);
    }
  });

  it("ORACLE_NO_ORCA_PDA_TWAP: program code never reads the Whirlpool Oracle PDA", () => {
    const dir = "programs/perma/src";
    const code = readdirSync(dir)
      .filter((f) => f.endsWith(".rs"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//")) // doc comments may name it to say "not a TWAP"
      .join("\n");
    for (const banned of ["volatility_accumulator", 'b"oracle"', "get_oracle_address", "accounts::Oracle", "Oracle::"]) {
      assert.notInclude(code, banned);
    }
  });
});
