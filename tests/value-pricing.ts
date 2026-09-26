/**
 * P5 - value-based premium (ADR-0006).
 *
 * Prototype. Not audited. Single pool. Not production mainnet risk capital.
 *
 *  - `set_premium_params` is admin-only, bounded, and prices only the future
 *  - no new long or short on a range narrower than `MIN_RANGE_TICKS` (32)
 *  - equal notionals pay equal premium on a narrow and a wide range
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
} from "@solana/web3.js";
import { assert, AssertionError } from "chai";
import { freshPrice } from "./oracle-mock";
import {
  liquidityFor,
  pricingAccounts,
  setPricing,
  SHIPPED_HORIZON,
  SHIPPED_MULT,
  SHIPPED_RATE,
  TEST_HORIZON,
  TEST_MULT,
  TEST_RATE,
} from "./pricing";

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
/** Around the frozen localnet spot (-39140). */
const WIDE = [-40176, -38168] as const; // 2008 ticks
const NARROW = [-39264, -39184] as const; // 80 ticks
const TOO_NARROW = [-39152, -39128] as const; // 24 ticks

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("value-pricing: premium on notional (P5, ADR-0006)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const i32le = (v: number) => new BN(v).toTwos(32).toArrayLike(Buffer, "le", 4);
  const { market, globalConfig, premiumIndex } = pricingAccounts(program, me);
  const marketAuthority = pda([Buffer.from("market_authority"), market.toBuffer()]);
  const userCollateral = pda([Buffer.from("collateral"), market.toBuffer(), me.toBuffer()]);
  const rangePda = ([lo, hi]: readonly number[]) =>
    pda([Buffer.from("range"), market.toBuffer(), i32le(lo), i32le(hi)]);
  const rangeVaultPda = ([lo, hi]: readonly number[]) =>
    pda([Buffer.from("range_vault"), market.toBuffer(), i32le(lo), i32le(hi)]);

  const NONCE_BASE = (Date.now() % 1_000_000_000) + 8_000_000_000; // value-pricing
  let n = 0;
  function posSet(range: readonly number[]) {
    const nonce = NONCE_BASE + ++n;
    const positionMint = Keypair.generate();
    return {
      nonce,
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
        me.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ]),
    };
  }
  type P = ReturnType<typeof posSet>;

  const mintAccounts = async (p: P) => ({
    owner: me, market, marketAuthority, userCollateral, permaPosition: p.permaPosition, premiumIndex,
    rangeState: rangePda(p.range), rangeVault: rangeVaultPda(p.range), whirlpool: PERMA_WHIRLPOOL,
    orcaPosition: p.orcaPosition, positionMint: p.positionMint.publicKey,
    positionTokenAccount: p.positionTokenAccount, tokenMintA: WSOL, tokenMintB: DEV_USDC,
    vaultA: VAULT_A, vaultB: VAULT_B, orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
    tickArrayLower: tickArrayPda(p.range[0]), tickArrayUpper: tickArrayPda(p.range[1]),
    tokenProgram: TOKEN_PROGRAM, associatedTokenProgram: ATA_PROGRAM, memoProgram: MEMO_PROGRAM,
    whirlpoolProgram: WHIRLPOOL_PROGRAM, systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY, priceUpdate: await freshPrice(provider),
  });
  const meta = (pk: PublicKey) => ({ pubkey: pk, isSigner: false, isWritable: false });
  const openLongs = async () => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: me.toBase58() } },
    ]);
    return all.filter((x: any) => x.account.legType === LEG_LONG && x.account.status === 0);
  };
  const mintShort = async (p: P, l: bigint) =>
    program.methods
      .mintPosition(LEG_SHORT, p.range[0], p.range[1], new BN(l.toString()), new BN(1_000_000_000), new BN(100_000_000), new BN(p.nonce))
      .accounts(await mintAccounts(p))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();
  const mintLong = async (p: P, l: bigint) =>
    program.methods
      .mintPosition(LEG_LONG, p.range[0], p.range[1], new BN(l.toString()), new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts((await openLongs()).map((x: any) => meta(x.publicKey)))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
  const burnAccounts = (p: P, long: boolean) => ({
    owner: me, market, marketAuthority, userCollateral, permaPosition: p.permaPosition, premiumIndex,
    rangeState: rangePda(p.range), rangeVault: rangeVaultPda(p.range),
    whirlpool: long ? null : PERMA_WHIRLPOOL, orcaPosition: long ? null : p.orcaPosition,
    positionMint: long ? null : p.positionMint.publicKey,
    positionTokenAccount: long ? null : p.positionTokenAccount,
    tokenMintA: long ? null : WSOL, tokenMintB: long ? null : DEV_USDC,
    vaultA: long ? null : VAULT_A, vaultB: VAULT_B,
    orcaVaultA: long ? null : ORCA_VAULT_A, orcaVaultB: long ? null : ORCA_VAULT_B,
    tickArrayLower: long ? null : tickArrayPda(p.range[0]), tickArrayUpper: long ? null : tickArrayPda(p.range[1]),
    tokenProgram: TOKEN_PROGRAM, memoProgram: long ? null : MEMO_PROGRAM,
    whirlpoolProgram: long ? null : WHIRLPOOL_PROGRAM,
  });
  const burn = (p: P, long: boolean) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts(burnAccounts(p, long))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();
  const settle = (p: P) =>
    program.methods
      .settlePremium()
      .accounts({
        cranker: me, owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex, rangeState: rangePda(p.range),
        rangeVault: rangeVaultPda(p.range), vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
      })
      .rpc();
  const slotOf = async (sig: string) => {
    await conn.confirmTransaction(sig, "confirmed");
    return BigInt((await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))!.slot);
  };
  const freeB = async () =>
    BigInt(((await (program.account as any).userCollateral.fetch(userCollateral)).balanceB).toString());
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
      assert.include(e.toString(), name);
    }
  };
  const setPremium = (rate: BN | number, mult: BN | number, admin = me, signers: Keypair[] = []) =>
    program.methods
      .setPremiumParams(new BN(rate.toString()), new BN(mult.toString()))
      .accounts({ admin, globalConfig, market, premiumIndex })
      .signers(signers)
      .rpc();
  const marketState = () => (program.account as any).market.fetch(market);

  const shorts: P[] = [];

  before(async () => {
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
          admin: me, globalConfig, market, marketAuthority, whirlpool: PERMA_WHIRLPOOL,
          vaultA: VAULT_A, vaultB: VAULT_B, whirlpoolProgram: WHIRLPOOL_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    const u = (await conn.getAccountInfo(userCollateral))
      ? await (program.account as any).userCollateral.fetch(userCollateral)
      : null;
    const hA = u ? BigInt(u.balanceA.toString()) : 0n;
    const hB = u ? BigInt(u.balanceB.toString()) : 0n;
    const topA = hA < 1_000_000_000n ? 1_000_000_000n - hA : 0n;
    const topB = hB < 50_000_000n ? 50_000_000n - hB : 0n;
    if (topA + topB > 0n) {
      await program.methods
        .depositCollateral(new BN(topA.toString()), new BN(topB.toString()))
        .accounts({
          owner: me, market, userCollateral, userTokenA: USER_A, userTokenB: USER_B,
          vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    await setPricing(program, me, { rate: TEST_RATE, mult: TEST_MULT, horizon: TEST_HORIZON });
  });

  describe("set_premium_params", () => {
    it("a non-admin is refused Unauthorized", async () => {
      const stranger = Keypair.generate();
      await conn.confirmTransaction(await conn.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL), "confirmed");
      await expectErr(setPremium(SHIPPED_RATE, SHIPPED_MULT, stranger.publicKey, [stranger]), "Unauthorized");
    });

    it("zero or above-ceiling values are refused InvalidPremiumParams and write nothing", async () => {
      const before = await marketState();
      for (const [r, m] of [
        [0, 1],
        [1, 0],
        [1_000_001, 1],
        [1, 1_001],
      ]) {
        await expectErr(setPremium(r, m), "InvalidPremiumParams");
      }
      await expectErr(setPremium(new BN("18446744073709551615"), new BN("18446744073709551615")), "InvalidPremiumParams");
      const after = await marketState();
      assert.equal(after.premiumRate.toString(), before.premiumRate.toString());
      assert.equal(after.premiumMultiplier.toString(), before.premiumMultiplier.toString());
    });

    it("a change prices only the future: the index advances at the old rate first", async () => {
      const i0 = await (program.account as any).globalPremiumIndex.fetch(premiumIndex);
      const oldRate = BigInt((await marketState()).premiumRate.toString());
      const sig = await setPremium(SHIPPED_RATE, SHIPPED_MULT);
      const slot = await slotOf(sig);
      const i1 = await (program.account as any).globalPremiumIndex.fetch(premiumIndex);
      const elapsed = slot - BigInt(i0.lastUpdateSlot.toString());
      assert.equal(BigInt(i1.lastUpdateSlot.toString()), slot);
      assert.equal(
        BigInt(i1.currentIndex.toString()),
        BigInt(i0.currentIndex.toString()) + elapsed * oldRate,
        "the slots before the change are indexed at the old rate"
      );
      const m = await marketState();
      assert.equal(m.premiumRate.toNumber(), SHIPPED_RATE);
      assert.equal(m.premiumMultiplier.toNumber(), SHIPPED_MULT);
      await setPremium(TEST_RATE, TEST_MULT);
    });
  });

  it("no new short or long on a range narrower than 32 ticks (RangeTooNarrow)", async () => {
    await expectErr(mintShort(posSet(TOO_NARROW), 1_000_000n), "RangeTooNarrow");
    await expectErr(mintLong(posSet(TOO_NARROW), 1_000n), "RangeTooNarrow");
  });

  it("equal notionals pay equal premium per slot on an 80-tick and a 2008-tick range", async () => {
    // Shorts to borrow against: ~2.8 USDC of notional on each range.
    for (const range of [WIDE, NARROW]) {
      const s = posSet(range);
      await mintShort(s, liquidityFor(3_000_000n, range[0], range[1]));
      shorts.push(s);
    }
    // Two longs of 1 USDC notional each: ~1_000 µUSDC per slot at test pricing.
    const wide = posSet(WIDE), narrow = posSet(NARROW);
    const lw = liquidityFor(1_000_000n, WIDE[0], WIDE[1]);
    const ln = liquidityFor(1_000_000n, NARROW[0], NARROW[1]);
    assert.isAbove(Number(ln / lw), 15, "the narrow range needs ~25x the liquidity");
    const mw = await slotOf(await mintLong(wide, lw));
    const mn = await slotOf(await mintLong(narrow, ln));
    await waitSlots(10);

    const perSlot = async (p: P, minted: bigint) => {
      const f0 = await freeB();
      const s = await slotOf(await settle(p));
      return Number(f0 - (await freeB())) / Number(s - minted);
    };
    const w = await perSlot(wide, mw);
    const nn = await perSlot(narrow, mn);
    assert.closeTo(w, 1_000, 30, `wide pays ${w}/slot`);
    assert.closeTo(nn, 1_000, 30, `narrow pays ${nn}/slot`);
    assert.isBelow(Math.abs(w - nn) / w, 0.03, "within 3 % of each other");

    await burn(wide, true);
    await burn(narrow, true);
  });

  after(async () => {
    for (const x of await openLongs()) {
      const a = x.account;
      await burn({ ...posSet([a.tickLower, a.tickUpper]), permaPosition: x.publicKey }, true).catch(() => {});
    }
    for (const s of shorts) await burn(s, false).catch(() => {});
    await setPricing(program, me, { rate: SHIPPED_RATE, mult: SHIPPED_MULT, horizon: SHIPPED_HORIZON });
  });
});
