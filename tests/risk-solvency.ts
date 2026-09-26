/**
 * Component 09 - Risk & Solvency (Fair MVP, ADR-0003).
 *
 * One question, asked before every path that could move free USDC out from
 * under a long's premium debt: can this user's free USDC cover what their open
 * longs already owe, plus a margin for what they will owe next?
 *
 * No price is read anywhere. Orca Whirlpool has no TWAP to read, and nothing
 * here would use one: the gate is token balances + premium liability + margin.
 *
 * The assertions that matter:
 *  - R1  a 1 µUSDC user cannot open a long (passed under the old stub)
 *  - R3  an open long's ACCRUED premium blocks a withdrawal, though nothing has
 *        been written to `premium_owed_usdc` - the exact gap 08 left open
 *  - R7  ...even if nobody cranked the index since the long opened (projection)
 *  - R5/R9 the remaining-account set cannot be shortened or padded
 *  - R6  short burn moves exactly `returned − locked` - no second P&L step
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
import { liquidityFor, testMargin, testPricing } from "./pricing";

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

/** `state::risk_defaults` + `premium_defaults`; asserted by tests/factory.ts. */
const HORIZON = 1_000n;
const BUFFER = 1_000_000n;
const MAX_OPEN_LONGS = 8;

const USDC = (n: number) => BigInt(n) * 1_000_000n;

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("risk-solvency: long premium liability + margin (component 09)", () => {
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
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 5_000_000_000; // risk-solvency
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

  // --- a second user, so R1 can start from exactly 1 µUSDC and R9 has a
  //     "someone else's long" to smuggle. Funded by an SPL transfer out of the
  //     fixture ATA, since devUSDC cannot be minted locally.
  const stranger = Keypair.generate();
  const strangerA = getAssociatedTokenAddressSync(WSOL, stranger.publicKey);
  const strangerB = getAssociatedTokenAddressSync(DEV_USDC, stranger.publicKey);

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

  /** `remaining` defaults to the truth; tests that tamper pass their own. */
  const mintLong = async (p: P, size: BN, signers: Keypair[] = [], remaining?: any[]) =>
    program.methods
      .mintPosition(LEG_LONG, TICK_LOWER, TICK_UPPER, size, new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p, TICK_LOWER, TICK_UPPER),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(remaining ?? (await openLongsOf(p.owner)))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers(signers)
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

  const burnLong = (p: P, signers: Keypair[] = []) =>
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
      .signers(signers)
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

  const withdrawAccounts = (owner: PublicKey, tokA = USER_A, tokB = USER_B) => ({
    owner, market, marketAuthority, userCollateral: collateralOf(owner),
    userTokenA: tokA, userTokenB: tokB, vaultA: VAULT_A, vaultB: VAULT_B,
    tokenProgram: TOKEN_PROGRAM, premiumIndex,
  });
  const withdraw = async (b: bigint, owner = me, signers: Keypair[] = [], remaining?: any[]) =>
    program.methods
      .withdrawCollateral(new BN(0), new BN(b.toString()))
      .accounts(
        owner.equals(me) ? withdrawAccounts(me) : withdrawAccounts(owner, strangerA, strangerB)
      )
      .remainingAccounts(remaining ?? (await openLongsOf(owner)))
      .signers(signers)
      .rpc();
  const deposit = (b: bigint, owner = me, signers: Keypair[] = []) =>
    program.methods
      .depositCollateral(new BN(0), new BN(b.toString()))
      .accounts({
        owner, market, userCollateral: collateralOf(owner),
        userTokenA: owner.equals(me) ? USER_A : strangerA,
        userTokenB: owner.equals(me) ? USER_B : strangerB,
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .signers(signers)
      .rpc();

  const uc = async (owner = me) => (program.account as any).userCollateral.fetch(collateralOf(owner));
  const freeB = async (owner = me) => BigInt((await uc(owner)).balanceB.toString());
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const rangeOf = () => (program.account as any).rangePremiumState.fetch(demoRange);
  const avail = async () => {
    const r = await rangeOf();
    return BigInt(r.totalShortLiquidity.toString()) - BigInt(r.totalLongLiquidity.toString());
  };
  /** ADR-0006 test pricing: ⌈notional⌉ + 1 USDC on the demo range. */
  const requiredMargin = (L: bigint) => testMargin(L, TICK_LOWER, TICK_UPPER);
  const waitSlots = async (k = 3) => {
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
  const ensureFreeB = async (min: bigint) => {
    const have = await freeB();
    if (have >= min) return;
    const top = min - have < (await amt(USER_B)) ? min - have : await amt(USER_B);
    if (top > 0n) await deposit(top);
  };

  let seedShort: P;

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

    // Me: enough WSOL for one seed short, and USDC headroom for the longs below.
    const have = (await conn.getAccountInfo(collateralOf(me))) ? await uc() : { balanceA: new BN(0) };
    const hA = BigInt(have.balanceA.toString());
    if (hA < 2_000_000_000n) {
      const topA = 2_000_000_000n - hA < (await amt(USER_A)) ? 2_000_000_000n - hA : await amt(USER_A);
      await program.methods
        .depositCollateral(new BN(topA.toString()), new BN(0))
        .accounts({
          owner: me, market, userCollateral: collateralOf(me), userTokenA: USER_A, userTokenB: USER_B,
          vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    await ensureFreeB(USDC(250));

    // The stranger: SOL for fees, both ATAs, 5 USDC from the fixture, deposited.
    await conn.confirmTransaction(
      await conn.requestAirdrop(stranger.publicKey, 2 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    const tx = new Transaction()
      .add(createAssociatedTokenAccountInstruction(me, strangerA, stranger.publicKey, WSOL))
      .add(createAssociatedTokenAccountInstruction(me, strangerB, stranger.publicKey, DEV_USDC))
      .add(createTransferInstruction(USER_B, strangerB, me, USDC(5)));
    await provider.sendAndConfirm(tx);
    await deposit(USDC(5), stranger.publicKey, [stranger]);

    seedShort = posSet(nextNonce());
    await mintShort(seedShort);
  });

  it("the market carries the test margin parameters", async () => {
    const m = await (program.account as any).market.fetch(market);
    assert.equal(BigInt(m.longMarginHorizonSlots.toString()), HORIZON);
    assert.equal(BigInt(m.longMarginBufferUsdc.toString()), BUFFER);
    // Test pricing, stated once: margin = ⌈notional⌉ + 1 USDC (ADR-0006).
    assert.equal(requiredMargin(liquidityFor(50_000_000n, TICK_LOWER, TICK_UPPER)), 51_000_000n);
  });

  it("R1: a user with 1 µUSDC cannot open a long (the old stub let them)", async () => {
    // Withdraw the stranger down to exactly 1 µUSDC. No open longs, so the
    // gate reduces to the legacy check and the withdraw is allowed.
    const have = await freeB(stranger.publicKey);
    await withdraw(have - 1n, stranger.publicKey, [stranger]);
    assert.equal(await freeB(stranger.publicKey), 1n);

    const p = posSet(nextNonce(), stranger.publicKey);
    await expectErr(mintLong(p, new BN(1), [stranger]), "InsolventMint");
    assert.isNull(await conn.getAccountInfo(p.permaPosition), "nothing was created");
    assert.equal((await uc(stranger.publicKey)).openLongs, 0);

    // Give the money back so later tests have a stranger with real USDC.
    await deposit(USDC(5) - 1n, stranger.publicKey, [stranger]);
  });

  it("R2: with margin in hand the long opens and open_longs increments", async () => {
    const L = 50_000_000n;
    assert.isAtLeast(Number(await avail()), Number(L), "inventory");
    await ensureFreeB(requiredMargin(L) + USDC(5));
    const before = (await uc()).openLongs;

    const p = posSet(nextNonce());
    await mintLong(p, new BN(L.toString()));
    assert.equal((await uc()).openLongs, before + 1, "counter maintained inside open_long");

    await burnLong(p);
    assert.equal((await uc()).openLongs, before, "and decremented inside close_long");
  });

  it("R3: accrued premium on an OPEN long blocks a withdrawal, though premium_owed_usdc is 0", async () => {
    const L = 50_000_000n;
    await ensureFreeB(requiredMargin(L) + USDC(20));
    const p = posSet(nextNonce());
    await mintLong(p, new BN(L.toString()));
    await waitSlots(5);

    const u = await uc();
    assert.equal(BigInt(u.premiumOwedUsdc.toString()), 0n, "the legacy field says nothing is owed");
    const free = BigInt(u.balanceB.toString());

    // Withdraw everything but the margin: the accrued-but-unsettled premium
    // must still be covered, so this is refused.
    await expectErr(withdraw(free - requiredMargin(L)), "InsolventWithdrawal");
    const pos = await (program.account as any).permaPosition.fetch(p.permaPosition);
    assert.equal(pos.status, STATUS_OPEN, "position untouched");
    assert.equal(await freeB(), free, "nothing moved");

    // Leaving comfortable headroom is fine.
    await withdraw(free - requiredMargin(L) - USDC(10));
    await burnLong(p);
  });

  it("R4: settle the long, then the remainder is withdrawable", async () => {
    const L = 50_000_000n;
    await ensureFreeB(requiredMargin(L) + USDC(20));
    const p = posSet(nextNonce());
    await mintLong(p, new BN(L.toString()));
    await waitSlots(4);

    // Settling moves the accrued premium into the range vault in cash and
    // resets the checkpoint, so only the margin (+ a slot or two of fresh
    // accrual) remains required.
    await settleLong(p);
    const free = await freeB();
    const slack = 5_000_000n; // ~ 100 slots of accrual on 50e6 at the demo rate
    await withdraw(free - requiredMargin(L) - slack);
    await burnLong(p);
  });

  it("R7: no crank between mint and withdraw - the projected index still counts the accrual", async () => {
    // The stored index is stale: nothing touches it after this mint. A gate
    // that read `current_index` would see zero accrual and let the withdrawal
    // through. The projection adds (now − last_update) × rate on the stack.
    const L = 50_000_000n;
    await ensureFreeB(requiredMargin(L) + USDC(20));
    const p = posSet(nextNonce());
    await mintLong(p, new BN(L.toString()));
    const idx = await (program.account as any).globalPremiumIndex.fetch(premiumIndex);
    await waitSlots(6);
    const idx2 = await (program.account as any).globalPremiumIndex.fetch(premiumIndex);
    assert.equal(idx2.currentIndex.toString(), idx.currentIndex.toString(), "stored index untouched");

    const free = await freeB();
    // Exactly the stored-index liability (== margin only) - refused, because
    // the real liability includes the uncranked slots.
    await expectErr(withdraw(free - requiredMargin(L)), "InsolventWithdrawal");
    await burnLong(p);
  });

  it("R5: omitting an open long from the remaining accounts is refused", async () => {
    const L = 10_000_000n;
    await ensureFreeB(requiredMargin(L) + USDC(10));
    const p = posSet(nextNonce());
    await mintLong(p, new BN(L.toString()));

    await expectErr(withdraw(1n, me, [], []), "MissingOpenLong");
    // ...and a second long cannot be opened while hiding the first.
    const q = posSet(nextNonce());
    await expectErr(mintLong(q, new BN(1_000), [], []), "MissingOpenLong");

    await withdraw(1n); // the honest set works
    await burnLong(p);
  });

  it("R9: the set cannot be padded - duplicates, someone else's long, a burned long's key", async () => {
    const L = 10_000_000n;
    await ensureFreeB(requiredMargin(L) + USDC(10));
    const mine = posSet(nextNonce());
    await mintLong(mine, new BN(L.toString()));
    const theirs = posSet(nextNonce(), stranger.publicKey);
    await mintLong(theirs, new BN(1), [stranger]); // needs 1.000001 USDC; stranger has ~5

    const meta = (pk: PublicKey) => ({ pubkey: pk, isSigner: false, isWritable: false });
    // count == open_longs (1) but the account is wrong / duplicated
    await expectErr(withdraw(1n, me, [], [meta(theirs.permaPosition)]), "MissingOpenLong");
    await expectErr(
      withdraw(1n, me, [], [meta(mine.permaPosition), meta(mine.permaPosition)]),
      "MissingOpenLong"
    );
    // a closed long's key: burn one, then present its (now empty) address
    const gone = posSet(nextNonce());
    await ensureFreeB(2n * requiredMargin(L) + USDC(10));
    await mintLong(gone, new BN(L.toString()));
    await burnLong(gone);
    await expectErr(
      withdraw(1n, me, [], [meta(mine.permaPosition), meta(gone.permaPosition)]),
      "MissingOpenLong"
    );

    await withdraw(1n);
    await burnLong(mine);
    await burnLong(theirs, [stranger]);
  });

  it("R8: the ninth long is refused with TooManyOpenLongs", async () => {
    const L = 1_000n; // tiny, so 8 of them cost ~8 USDC of margin
    await ensureFreeB(BigInt(MAX_OPEN_LONGS + 1) * requiredMargin(L) + USDC(5));
    const opened: P[] = [];
    for (let i = (await uc()).openLongs; i < MAX_OPEN_LONGS; i++) {
      const p = posSet(nextNonce());
      await mintLong(p, new BN(L.toString()));
      opened.push(p);
    }
    assert.equal((await uc()).openLongs, MAX_OPEN_LONGS);

    const ninth = posSet(nextNonce());
    await expectErr(mintLong(ninth, new BN(L.toString())), "TooManyOpenLongs");

    // A withdraw carrying all eight still fits in one transaction.
    await withdraw(1n);
    for (const p of opened) await burnLong(p);
    assert.equal((await uc()).openLongs, 0);
  });

  it("R6: short burn moves exactly returned − locked - there is no second P&L step", async () => {
    const pos = await (program.account as any).permaPosition.fetch(seedShort.permaPosition);
    const lockedA = BigInt(pos.lockedA.toString()), lockedB = BigInt(pos.lockedB.toString());
    const u0 = await uc();
    const freeA0 = BigInt(u0.balanceA.toString()), freeB0 = BigInt(u0.balanceB.toString());
    const lA0 = BigInt(u0.lockedA.toString()), lB0 = BigInt(u0.lockedB.toString());
    const vA0 = await amt(VAULT_A), vB0 = await amt(VAULT_B), esc0 = await amt(demoVault);

    await burnShort(seedShort);

    const u1 = await uc();
    const dFreeA = BigInt(u1.balanceA.toString()) - freeA0;
    const dFreeB = BigInt(u1.balanceB.toString()) - freeB0;
    assert.equal(lA0 - BigInt(u1.lockedA.toString()), lockedA, "locked_a released by what mint locked");
    assert.equal(lB0 - BigInt(u1.lockedB.toString()), lockedB, "locked_b released by what mint locked");

    // What Orca returned == what the vault gained == what free gained (plus any
    // premium claimed from the escrow on side B). No other USDC moved.
    const returnedA = (await amt(VAULT_A)) - vA0;
    const claimed = esc0 - (await amt(demoVault));
    const returnedB = (await amt(VAULT_B)) - vB0 - claimed;
    assert.equal(dFreeA, returnedA, "free_a += returned_a, exactly");
    assert.equal(dFreeB, returnedB + claimed, "free_b += returned_b + premium claimed, nothing else");
  });

  after(async () => {
    for (const owner of [me, stranger.publicKey]) {
      for (const { pubkey } of await openLongsOf(owner)) {
        const account = await (program.account as any).permaPosition.fetch(pubkey);
        const p = { ...posSet(Number(account.nonce), owner), permaPosition: pubkey };
        await burnLong(p, owner.equals(me) ? [] : [stranger]).catch(() => {});
      }
    }
    const r = await rangeOf();
    assert.equal(r.totalLongLiquidity.toString(), "0", "suite must leave no longs");
    await pricing.restore();
  });
});
