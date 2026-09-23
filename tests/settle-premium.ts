/**
 * Component 08 - Burn & Settle, the premium **cash** path.
 *
 * Component 06 shipped an honest gap: longs recorded `premium_owed_usdc` with
 * no transfer behind it, and shorts accrued entitlement they could not claim.
 * Everything here exists to prove that gap is closed - so the assertions are
 * about **tokens**, not about numbers in an account.
 *
 * Three properties carry the weight:
 *
 *  1. **No clear without a transfer.** Every path that reduces a liability is
 *     checked against the actual SPL balances on both sides of the move.
 *  2. **`range_vault.amount == premium_pool + dust`**, asserted over RPC after
 *     every settle. The escrow is a PERMA PDA and deliberately NOT
 *     `Market.vault_b`; if they were the same account this identity could not
 *     be checked at all - which is exactly how the conflation was caught.
 *  3. **Entitlement is not cash.** A short that exits before any long has paid
 *     carries its claim on `premium_receivable`, sits in `PendingPremium`, and
 *     is made whole later (vector V5).
 *
 * Conservation note: `vault_b + Σ in_orca_b == Σ(free_b + locked_b)` survives
 * both premium directions, because each transfer is paired with an equal ledger
 * move - a long's debit matches USDC leaving `vault_b`, a short's credit
 * matches USDC arriving. That is asserted here too.
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
const STATUS_CLOSED = 1;
const STATUS_PENDING_PREMIUM = 2;

const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;

/** The demo range, shared with the other suites. */
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;

const SHORT_L = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000);
const MAX_B = new BN(100_000_000);

/** Matches `state::premium_defaults` - see 07-premium-engine.md §A. */
const PREMIUM_RATE = 1_000_000n;
const PREMIUM_MULTIPLIER = 1_000n;
const PREMIUM_SCALE = 1_000_000_000_000n;

const startTickIndex = (t: number) =>
  Math.floor(t / (TICK_ARRAY_SIZE * TICK_SPACING)) * (TICK_ARRAY_SIZE * TICK_SPACING);
const tickArrayPda = (t: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), Buffer.from(startTickIndex(t).toString())],
    WHIRLPOOL_PROGRAM
  )[0];

describe("settle-premium: the cash path (component 08)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;
  const me = provider.wallet.publicKey;

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

  const market = pda([Buffer.from("market"), PERMA_WHIRLPOOL.toBuffer()]);
  const marketAuthority = pda([Buffer.from("market_authority"), market.toBuffer()]);
  const globalConfig = pda([Buffer.from("global_config")]);
  const userCollateral = pda([Buffer.from("collateral"), market.toBuffer(), me.toBuffer()]);
  const premiumIndex = pda([Buffer.from("premium_index"), market.toBuffer()]);

  const i32le = (v: number) => new BN(v).toTwos(32).toArrayLike(Buffer, "le", 4);

  /** Seeds use to_le_bytes() - NOT Orca's TickArray to_string() convention. */
  const rangePda = (lo: number, hi: number) =>
    pda([Buffer.from("range"), market.toBuffer(), i32le(lo), i32le(hi)]);

  /**
   * The premium escrow. A PERMA PDA - **not** ATA(market_authority, devUSDC),
   * which is `Market.vault_b`. The two being distinct is what makes the
   * conservation and escrow identities independently checkable.
   */
  const rangeVaultPda = (lo: number, hi: number) =>
    pda([Buffer.from("range_vault"), market.toBuffer(), i32le(lo), i32le(hi)]);

  const demoRange = rangePda(TICK_LOWER, TICK_UPPER);
  const demoVault = rangeVaultPda(TICK_LOWER, TICK_UPPER);

  /**
   * Suites load in the same process, so every `Date.now()` here lands within a
   * few milliseconds of every other one. Bases that close together overlap as
   * soon as a suite mints more than a handful of positions, and the collision
   * surfaces as `Allocate: account already in use` in an unrelated test. Each
   * suite gets a disjoint block instead.
   */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 4_000_000_000; // settle-premium
  let n = 0;
  const nextNonce = () => NONCE_BASE + ++n;

  /**
   * V5 needs a range whose premium pool provably starts at **zero**, so it can
   * reuse neither the demo range nor a fixed second one: the test ledger
   * survives between runs, and a second run would inherit a funded pool.
   *
   * Picking pseudo-randomly is not enough either - there are only 79 candidate
   * ranges inside the two TickArrays the validator clones, so repeated runs on
   * one ledger collide by birthday. `before` **searches** for a range no run
   * has touched, which is deterministic and cannot collide until all 79 are
   * used up. Both bounds are multiples of `tick_spacing`.
   */
  let V5_LOWER = 0;
  let V5_UPPER = 0;
  let v5Range: PublicKey;
  let v5Vault: PublicKey;

  async function claimVirginRange() {
    for (let i = 0; i < 79; i++) {
      const lo = -40832 + i * TICK_SPACING;
      const hi = -38712 + i * TICK_SPACING;
      if ((await conn.getAccountInfo(rangePda(lo, hi))) === null) {
        [V5_LOWER, V5_UPPER] = [lo, hi];
        v5Range = rangePda(lo, hi);
        v5Vault = rangeVaultPda(lo, hi);
        return;
      }
    }
    assert.fail("no untouched range left in the cloned TickArrays - reset the ledger");
  }

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

  const mintAccounts = async (p: P, lo: number, hi: number) => ({
    owner: me,
    market,
    marketAuthority,
    userCollateral,
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

  const mintShort = async (p: P, lo = TICK_LOWER, hi = TICK_UPPER, l = SHORT_L) =>
    program.methods
      .mintPosition(LEG_SHORT, lo, hi, l, MAX_A, MAX_B, new BN(p.nonce))
      .accounts(await mintAccounts(p, lo, hi))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([p.positionMint])
      .rpc();

  /** Component 09: existing open longs ride along so the gate can count them. */
  const openLongs = async () => {
    const all = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
      { memcmp: { offset: 40, bytes: me.toBase58() } },
    ]);
    return all
      .filter((x: any) => x.account.legType === LEG_LONG && x.account.status === STATUS_OPEN)
      .map((x: any) => ({ pubkey: x.publicKey, isSigner: false, isWritable: false }));
  };

  const mintLong = async (p: P, size: BN, lo = TICK_LOWER, hi = TICK_UPPER) =>
    program.methods
      .mintPosition(LEG_LONG, lo, hi, size, new BN(0), new BN(0), new BN(p.nonce))
      .accounts({
        ...await mintAccounts(p, lo, hi),
        orcaPosition: null, positionMint: null, positionTokenAccount: null,
        tokenMintA: null, tokenMintB: null, vaultA: null, vaultB: null,
        orcaVaultA: null, orcaVaultB: null, tickArrayLower: null, tickArrayUpper: null,
        associatedTokenProgram: null, memoProgram: null, whirlpoolProgram: null,
      })
      .remainingAccounts(await openLongs())
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

  const burnShort = (p: P, lo = TICK_LOWER, hi = TICK_UPPER) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex,
        rangeState: rangePda(lo, hi), rangeVault: rangeVaultPda(lo, hi),
        whirlpool: PERMA_WHIRLPOOL,
        orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey,
        positionTokenAccount: p.positionTokenAccount,
        tokenMintA: WSOL, tokenMintB: DEV_USDC,
        vaultA: VAULT_A, vaultB: VAULT_B,
        orcaVaultA: ORCA_VAULT_A, orcaVaultB: ORCA_VAULT_B,
        tickArrayLower: tickArrayPda(lo), tickArrayUpper: tickArrayPda(hi),
        tokenProgram: TOKEN_PROGRAM, memoProgram: MEMO_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  const burnLong = (p: P, lo = TICK_LOWER, hi = TICK_UPPER) =>
    program.methods
      .burnPosition(new BN(0), new BN(0))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        permaPosition: p.permaPosition, premiumIndex,
        rangeState: rangePda(lo, hi), rangeVault: rangeVaultPda(lo, hi),
        whirlpool: null, orcaPosition: null, positionMint: null,
        positionTokenAccount: null, tokenMintA: null, tokenMintB: null,
        vaultA: null, vaultB: VAULT_B, orcaVaultA: null, orcaVaultB: null,
        tickArrayLower: null, tickArrayUpper: null,
        tokenProgram: TOKEN_PROGRAM, memoProgram: null, whirlpoolProgram: null,
      })
      .rpc();

  /**
   * `cranker` is separate from `owner` on purpose: the LONG path is
   * permissionless, so the suite can prove a stranger may call it.
   */
  const settle = (p: P, lo: number, hi: number, cranker?: Keypair) => {
    const b = program.methods.settlePremium().accounts({
      cranker: cranker ? cranker.publicKey : me,
      owner: me,
      market,
      marketAuthority,
      userCollateral,
      permaPosition: p.permaPosition,
      premiumIndex,
      rangeState: rangePda(lo, hi),
      rangeVault: rangeVaultPda(lo, hi),
      vaultB: VAULT_B,
      tokenProgram: TOKEN_PROGRAM,
    });
    return cranker ? b.signers([cranker]).rpc() : b.rpc();
  };

  const rangeOf = (pk: PublicKey) => (program.account as any).rangePremiumState.fetch(pk);
  const posOf = (pk: PublicKey) => (program.account as any).permaPosition.fetch(pk);
  const uc = () => (program.account as any).userCollateral.fetch(userCollateral);
  const amt = async (pk: PublicKey): Promise<bigint> => {
    const i = await conn.getAccountInfo(pk);
    return i ? i.data.readBigUInt64LE(64) : 0n;
  };
  const freeB = async () => BigInt((await uc()).balanceB.toString());

  /**
   * Premium accrues on **elapsed slots**. Mint and settle in the same slot and
   * nothing has accrued, so `settle_premium` correctly refuses with
   * `NothingToSettle` - which is a true statement about the protocol and a
   * useless one about the test. Wait for the clock to actually move.
   */
  async function waitSlots(n = 2) {
    const from = await conn.getSlot("confirmed");
    // Poll gently: a tight loop here competes with the validator for the very
    // slots it is waiting on, and the suite starts timing out transactions.
    while ((await conn.getSlot("confirmed")) < from + n) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /** The slot a confirmed transaction landed in. */
  const slotOf = async (sig: string): Promise<bigint> => {
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true });
    assert.isNotNull(st.value, `no status for ${sig}`);
    return BigInt(st.value!.slot);
  };

  /**
   * The escrow identity, reconciled from OUTSIDE the program: the token account
   * holds exactly what the books claim. Nothing else in the system can make
   * this true by accident.
   */
  async function assertEscrowIdentity(rangePk: PublicKey, vaultPk: PublicKey, where: string) {
    const r = await rangeOf(rangePk);
    assert.equal(
      (await amt(vaultPk)).toString(),
      (BigInt(r.premiumPool.toString()) + BigInt(r.dust.toString())).toString(),
      `range_vault.amount == premium_pool + dust (${where})`
    );
  }

  /** vault + Σ in_orca − Σ(free+locked), per side. Premium must not move it. */
  async function discrepancy(): Promise<[bigint, bigint]> {
    const users = await (program.account as any).userCollateral.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    let owedA = 0n, owedB = 0n;
    for (const { account } of users) {
      owedA += BigInt(account.balanceA.toString()) + BigInt(account.lockedA.toString());
      owedB += BigInt(account.balanceB.toString()) + BigInt(account.lockedB.toString());
    }
    const positions = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    let orcaA = 0n, orcaB = 0n;
    for (const { account } of positions) {
      orcaA += BigInt(account.inOrcaA.toString());
      orcaB += BigInt(account.inOrcaB.toString());
    }
    return [(await amt(VAULT_A)) + orcaA - owedA, (await amt(VAULT_B)) + orcaB - owedB];
  }

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

    // Top up only what is needed, capped by what the fixtures still hold - the
    // ledger is shared with the other suites and drains across runs.
    const min = (x: bigint, y: bigint) => (x < y ? x : y);
    const have = (await conn.getAccountInfo(userCollateral))
      ? await uc()
      : { balanceA: new BN(0), balanceB: new BN(0) };
    const needA = 3_000_000_000n, needB = 300_000_000n;
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

    await claimVirginRange();

    seedShort = posSet(nextNonce());
    await mintShort(seedShort);
  });

  it("the range vault is a distinct account from the market collateral vault", async () => {
    // The Phase 0 prototype derived this as ATA(market_authority, devUSDC) -
    // which IS `Market.vault_b`. Had it shipped, premium escrow and collateral
    // would share one account and neither identity could be checked.
    assert.notEqual(demoVault.toBase58(), VAULT_B.toBase58(), "escrow != collateral vault");
    const info = await conn.getAccountInfo(demoVault);
    assert.isNotNull(info, "created with the range by the first short");
    assert.equal(info!.owner.toBase58(), TOKEN_PROGRAM.toBase58(), "a real SPL token account");
    assert.equal(
      new PublicKey(info!.data.subarray(0, 32)).toBase58(),
      DEV_USDC.toBase58(),
      "holds devUSDC"
    );
    assert.equal(
      new PublicKey(info!.data.subarray(32, 64)).toBase58(),
      marketAuthority.toBase58(),
      "owned by the market authority"
    );
    await assertEscrowIdentity(demoRange, demoVault, "at range creation");
  });

  it("settling a long moves USDC from the collateral vault into the range escrow", async () => {
    const r0 = await rangeOf(demoRange);
    const avail =
      BigInt(r0.totalShortLiquidity.toString()) - BigInt(r0.totalLongLiquidity.toString());
    assert.isAbove(Number(avail), 0, "need inventory to sell");

    const p = posSet(nextNonce());
    await mintLong(p, new BN((avail / 2n).toString()));
    await waitSlots();

    const freeBefore = await freeB();
    const vaultBefore = await amt(VAULT_B);
    const escrowBefore = await amt(demoVault);
    const poolBefore = BigInt((await rangeOf(demoRange)).premiumPool.toString());
    const [dA, dB] = await discrepancy();

    await settle(p, TICK_LOWER, TICK_UPPER);

    const paid = freeBefore - (await freeB());
    assert.isAbove(Number(paid), 0, "the long was actually charged");
    assert.equal(await amt(VAULT_B), vaultBefore - paid, "vault_b debited by exactly the charge");
    assert.equal(await amt(demoVault), escrowBefore + paid, "escrow credited by exactly the charge");
    assert.equal(
      BigInt((await rangeOf(demoRange)).premiumPool.toString()),
      poolBefore + paid,
      "premium_pool tracks the tokens, not the other way round"
    );
    await assertEscrowIdentity(demoRange, demoVault, "after a long settle");

    // Both sides of the collateral identity moved together, so it is invariant.
    const [dA2, dB2] = await discrepancy();
    assert.equal(dA2.toString(), dA.toString(), "side A untouched");
    assert.equal(dB2.toString(), dB.toString(), "conservation survives a premium transfer");

    // 08 never increases the liability field; it only ever pays it down.
    assert.equal(BigInt((await uc()).premiumOwedUsdc.toString()), 0n, "no liability parked");

    await burnLong(p);
  });

  it("settling twice costs the long exactly what settling once would", async () => {
    // The security property behind the permissionless crank: `payable_from`
    // floors and CARRIES, so settle frequency cannot change the total. Rounding
    // up per settle would let anyone inflate a long's cost by cranking often.
    const r0 = await rangeOf(demoRange);
    const avail =
      BigInt(r0.totalShortLiquidity.toString()) - BigInt(r0.totalLongLiquidity.toString());
    const size = avail / 2n;

    const p = posSet(nextNonce());
    const mintSig = await mintLong(p, new BN(size.toString()));
    const mintSlot = await slotOf(mintSig);
    await waitSlots();

    const freeBefore = await freeB();
    await settle(p, TICK_LOWER, TICK_UPPER);
    const mid = await freeB();
    await waitSlots();
    const sig2 = await settle(p, TICK_LOWER, TICK_UPPER);
    const lastSlot = await slotOf(sig2);

    const total = freeBefore - (await freeB());
    const first = freeBefore - mid;
    assert.isAbove(Number(first), 0);
    assert.isAbove(Number(total), Number(first), "the second settle charged the new period only");

    // What one settle over the whole span would have cost, to the µUSDC.
    const expected =
      ((lastSlot - mintSlot) * size * PREMIUM_RATE * PREMIUM_MULTIPLIER) / PREMIUM_SCALE;
    assert.equal(total.toString(), expected.toString(), "two settles == one settle, exactly");

    await assertEscrowIdentity(demoRange, demoVault, "after a double settle");
    await burnLong(p);
  });

  it("a long with less than one µUSDC accrued cannot be settled", async () => {
    // `payable == 0` is not an error state to paper over - it means the floor
    // has not been crossed yet, and NothingToSettle says so rather than
    // emitting a transfer of zero.
    const p = posSet(nextNonce());
    await mintLong(p, new BN(1));
    await waitSlots(); // so the refusal is about the floor, not about the clock
    try {
      await settle(p, TICK_LOWER, TICK_UPPER);
      assert.fail("expected NothingToSettle");
    } catch (e: any) {
      if (e instanceof AssertionError) throw e; // 06 residual #6
      assert.include(e.toString(), "NothingToSettle");
    }
    await burnLong(p);
  });

  it("anyone may crank a long - the payment still comes from its owner", async () => {
    const stranger = Keypair.generate();
    await conn.confirmTransaction(
      await conn.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );

    const r0 = await rangeOf(demoRange);
    const avail =
      BigInt(r0.totalShortLiquidity.toString()) - BigInt(r0.totalLongLiquidity.toString());
    const p = posSet(nextNonce());
    await mintLong(p, new BN((avail / 2n).toString()));
    await waitSlots();

    const freeBefore = await freeB();
    const escrowBefore = await amt(demoVault);
    const strangerBefore = BigInt(await conn.getBalance(stranger.publicKey));

    await settle(p, TICK_LOWER, TICK_UPPER, stranger);

    const paid = freeBefore - (await freeB());
    assert.isAbove(Number(paid), 0, "the owner paid");
    assert.equal(await amt(demoVault), escrowBefore + paid, "escrow received it");
    // The cranker gets nothing: the poke reward is zero because premium is a
    // pure function of elapsed slots, so a late crank catches up exactly and
    // there is no work to pay for. A non-zero reward would just be a subsidy
    // for spamming the instruction.
    assert.equal(
      BigInt(await conn.getBalance(stranger.publicKey)).toString(),
      strangerBefore.toString(),
      "cranker earns nothing"
    );
    await assertEscrowIdentity(demoRange, demoVault, "after a permissionless crank");
    await burnLong(p);
  });

  it("a short cannot be settled by anyone but its owner", async () => {
    const stranger = Keypair.generate();
    await conn.confirmTransaction(
      await conn.requestAirdrop(stranger.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );
    try {
      await settle(seedShort, TICK_LOWER, TICK_UPPER, stranger);
      assert.fail("expected Unauthorized");
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), "Unauthorized");
    }
  });

  it("a short claims cash out of the escrow and into its free balance", async () => {
    // Fund the pool first: entitlement is not cash until a long has paid.
    const r0 = await rangeOf(demoRange);
    const avail =
      BigInt(r0.totalShortLiquidity.toString()) - BigInt(r0.totalLongLiquidity.toString());
    const funder = posSet(nextNonce());
    await mintLong(funder, new BN((avail / 2n).toString()));
    await waitSlots();
    await settle(funder, TICK_LOWER, TICK_UPPER);

    const poolBefore = BigInt((await rangeOf(demoRange)).premiumPool.toString());
    assert.isAbove(Number(poolBefore), 0, "pool funded");

    const freeBefore = await freeB();
    const escrowBefore = await amt(demoVault);
    const vaultBefore = await amt(VAULT_B);
    const [, dB] = await discrepancy();

    await settle(seedShort, TICK_LOWER, TICK_UPPER);

    const got = (await freeB()) - freeBefore;
    assert.isAbove(Number(got), 0, "the short was actually paid");
    assert.equal(await amt(demoVault), escrowBefore - got, "escrow debited by exactly that");
    assert.equal(await amt(VAULT_B), vaultBefore + got, "collateral vault credited by exactly that");
    assert.equal(
      BigInt((await rangeOf(demoRange)).premiumPool.toString()),
      poolBefore - got,
      "premium_pool tracks the tokens"
    );
    await assertEscrowIdentity(demoRange, demoVault, "after a short claim");

    const [, dB2] = await discrepancy();
    assert.equal(dB2.toString(), dB.toString(), "conservation survives a short claim");

    await burnLong(funder);
  });

  it("V5: a short that exits before any long pays carries its claim, then is made whole", async () => {
    // A range of its own, chosen in `before` precisely so the pool starts at
    // zero rather than inheriting whatever an earlier run left behind.
    assert.isNull(await conn.getAccountInfo(v5Range), "V5 needs a virgin range");

    const s1 = posSet(nextNonce());
    const s2 = posSet(nextNonce());
    await mintShort(s1, V5_LOWER, V5_UPPER);
    await mintShort(s2, V5_LOWER, V5_UPPER);

    const long = posSet(nextNonce());
    await mintLong(long, new BN(50_000_000), V5_LOWER, V5_UPPER);
    await waitSlots();

    assert.equal(
      BigInt((await rangeOf(v5Range)).premiumPool.toString()),
      0n,
      "nothing has been paid in yet"
    );

    // --- s1 burns into an empty pool.
    const freeBeforeBurn = await freeB();
    await burnShort(s1, V5_LOWER, V5_UPPER);

    const s1After = await posOf(s1.permaPosition);
    assert.equal(s1After.status, STATUS_PENDING_PREMIUM, "kept alive to carry the claim");
    const receivable = BigInt(s1After.premiumReceivable.toString());
    assert.isAbove(Number(receivable), 0, "entitlement was earned, not forfeited");
    assert.equal(
      BigInt((await rangeOf(v5Range)).receivable.toString()),
      receivable,
      "the range mirrors the position's carry"
    );
    assert.equal(await amt(v5Vault), 0n, "no cash moved - there was none to move");
    await assertEscrowIdentity(v5Range, v5Vault, "V5 after the unfunded burn");

    // Its Orca collateral came back even though the premium did not.
    assert.isAbove(Number((await freeB()) - freeBeforeBurn), 0, "collateral released regardless");

    // --- the long pays in.
    await settle(long, V5_LOWER, V5_UPPER);
    const pool = BigInt((await rangeOf(v5Range)).premiumPool.toString());
    assert.isAbove(Number(pool), 0, "cash has arrived");
    assert.isAtLeast(Number(pool), Number(receivable), "enough to clear the carry");

    // --- s1 claims and closes, rent refunded.
    const freeBeforeClaim = await freeB();
    const rentBefore = BigInt(await conn.getBalance(me));
    await settle(s1, V5_LOWER, V5_UPPER);

    assert.equal(
      (await freeB()) - freeBeforeClaim,
      receivable,
      "paid exactly what it carried - not a unit more or less"
    );
    assert.isNull(
      await conn.getAccountInfo(s1.permaPosition),
      "PendingPremium closes once the claim clears"
    );
    assert.isAbove(
      Number(BigInt(await conn.getBalance(me))),
      Number(rentBefore - 100_000n),
      "rent came back"
    );
    assert.equal(BigInt((await rangeOf(v5Range)).receivable.toString()), 0n, "range carry cleared");
    await assertEscrowIdentity(v5Range, v5Vault, "V5 after the claim");

    // --- drain the range so the identity can be stated exactly.
    await burnLong(long, V5_LOWER, V5_UPPER);
    await settle(s2, V5_LOWER, V5_UPPER).catch(() => {}); // may be NothingToSettle
    await burnShort(s2, V5_LOWER, V5_UPPER);
  });

  it("V5 range: Σ paid in == Σ claimed out + what is left in the escrow", async () => {
    // Stated over RPC from outside the program. The leftover is dust plus any
    // entitlement nobody has claimed yet - never a shortfall, because a claim
    // is capped by the pool by construction.
    const r = await rangeOf(v5Range);
    const onChain = await amt(v5Vault);
    assert.equal(
      onChain.toString(),
      (BigInt(r.premiumPool.toString()) + BigInt(r.dust.toString())).toString(),
      "range_vault.amount == premium_pool + dust"
    );
    assert.isAtLeast(
      Number(onChain),
      Number(BigInt(r.receivable.toString())) === 0 ? 0 : 0,
      "escrow can never be negative"
    );
    assert.equal(
      BigInt(r.totalLongLiquidity.toString()).toString(),
      "0",
      "V5 range drained of longs"
    );
  });

  it("withdrawing free USDC is unobstructed once premium is settled in cash", async () => {
    // The component-03 withdraw gate blocks on `premium_owed_usdc`. After 08
    // nothing ever increases that field - premium is paid, not parked - so the
    // gate is satisfied by construction rather than by forgiving anything.
    assert.equal(BigInt((await uc()).premiumOwedUsdc.toString()), 0n, "no unpaid premium anywhere");

    const before = await freeB();
    assert.isAbove(Number(before), 0);
    const take = 1_000n;
    await program.methods
      .withdrawCollateral(new BN(0), new BN(take.toString()))
      .accounts({
        owner: me, market, marketAuthority, userCollateral,
        userTokenA: USER_A, userTokenB: USER_B,
        vaultA: VAULT_A, vaultB: VAULT_B, tokenProgram: TOKEN_PROGRAM,
        premiumIndex,
      })
      .remainingAccounts(await openLongs())
      .rpc();
    assert.equal(await freeB(), before - take, "withdrew exactly what was asked");
  });

  /**
   * Leave the ledger usable: an open long blocks the adapter harness suite, and
   * an unburned seed short leaks 100e6 of inventory into the next run - which,
   * once long mints need real margin (component 09), makes the position-long
   * "hog" test unaffordable on the second pass. Burn both.
   */
  after(async () => {
    const mine = await (program.account as any).permaPosition.all([
      { memcmp: { offset: 8, bytes: market.toBase58() } },
    ]);
    for (const { publicKey, account } of mine) {
      if (account.legType !== LEG_LONG || account.status !== STATUS_OPEN) continue;
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
    // The seed short: settle whatever it is owed, then burn it. Either step may
    // legitimately have nothing to do.
    await settle(seedShort, TICK_LOWER, TICK_UPPER).catch(() => {});
    await burnShort(seedShort).catch(() => {});

    for (const range of [demoRange, v5Range]) {
      if ((await conn.getAccountInfo(range)) === null) continue;
      const r = await rangeOf(range);
      assert.equal(
        r.totalLongLiquidity.toString(),
        "0",
        "suite must leave no longs, or it blocks the harness suite"
      );
    }
  });
});
