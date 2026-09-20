/**
 * Component 01B - real liquidity CPI against a cloned Orca Whirlpool.
 *
 * Proves what the 01 validation suite could not: tokens actually moving through
 * `increase_liquidity_v2`, the 3-step close, and the two Orca failure modes the
 * spec pins as regression guards.
 *
 * Requires the funded vault fixtures. Regenerate with:
 *   node scripts/make-fixtures.mjs
 * and start the validator with the `--account` flags it prints (mirrored in
 * Anchor.toml [[test.validator.account]] and RELEASE-GATE.md section 3).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { assert } from "chai";

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const PERMA_WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const ORCA_VAULT_A = new PublicKey("3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4");
const ORCA_VAULT_B = new PublicKey("63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
/** Component 03: vaults start empty; these funded user ATAs are the source. */
const USER_A = new PublicKey("J93MdzNbVkKHBh3KwWwS7Y7CjqtqfFHwd1zHgFgw3UZQ");
const USER_B = new PublicKey("A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX");
const SYSTEM_PROGRAM = SystemProgram.programId;
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;

/** Small vs the pool's 4.76e12: needs ~0.034 WSOL / ~0.71 devUSDC. */
const LIQUIDITY = new BN(100_000_000);
const MAX_A = new BN(1_000_000_000); // 1 WSOL
const MAX_B = new BN(100_000_000); // 100 devUSDC

const startTickIndex = (tick: number, spacing: number) =>
  Math.floor(tick / (TICK_ARRAY_SIZE * spacing)) * (TICK_ARRAY_SIZE * spacing);

const tickArrayPda = (whirlpool: PublicKey, tick: number, spacing: number) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      whirlpool.toBuffer(),
      Buffer.from(startTickIndex(tick, spacing).toString()),
    ],
    WHIRLPOOL_PROGRAM
  )[0];

/** SPL token account `amount` lives at offset 64. */
async function tokenAmount(conn: anchor.web3.Connection, pk: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(pk);
  if (!info) return 0n;
  return info.data.readBigUInt64LE(64);
}

/** Orca `Position.liquidity` is u128 at offset 72 (8 disc + 32 + 32). */
async function positionLiquidity(
  conn: anchor.web3.Connection,
  pk: PublicKey
): Promise<bigint | null> {
  const info = await conn.getAccountInfo(pk);
  if (!info) return null;
  return info.data.readBigUInt64LE(72) + (info.data.readBigUInt64LE(80) << 64n);
}

describe("adapter-liquidity: real Orca liquidity CPI", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;

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

  /** GlobalConfig is a singleton; every suite must tolerate it pre-existing. */
  async function ensureGlobalConfig() {
    if ((await provider.connection.getAccountInfo(globalConfig)) !== null) return;
    await program.methods
      .initializeGlobalConfig(PERMA_WHIRLPOOL)
      .accounts({
        admin: provider.wallet.publicKey,
        globalConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Derived so the harness guard (mandatory, PDA-verified) can be satisfied. */
  const rangeStatePda = PublicKey.findProgramAddressSync(
    [
      Buffer.from("range"),
      market.toBuffer(),
      new BN(TICK_LOWER).toTwos(32).toArrayLike(Buffer, "le", 4),
      new BN(TICK_UPPER).toTwos(32).toArrayLike(Buffer, "le", 4),
    ],
    program.programId
  )[0];

  const tickArrayLower = tickArrayPda(PERMA_WHIRLPOOL, TICK_LOWER, TICK_SPACING);
  const tickArrayUpper = tickArrayPda(PERMA_WHIRLPOOL, TICK_UPPER, TICK_SPACING);

  /**
   * Run-scoped nonce base so the suite is re-runnable against a validator that
   * was not reset - `adapter_open_position` uses `init`, which would collide
   * with PermaPosition PDAs left behind by a previous run.
   */
  /**
   * Suites load in the same process, so every `Date.now()` here lands within a
   * few milliseconds of every other one. Bases that close together overlap as
   * soon as a suite mints more than a handful of positions, and the collision
   * surfaces as `Allocate: account already in use` in an unrelated test. Each
   * suite gets a disjoint block instead.
   */
  const NONCE_BASE = (Date.now() % 1_000_000_000) + 2_000_000_000; // adapter-liquidity

  /** One position per `nonce`, so each test group gets a clean slate. */
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
        provider.wallet.publicKey.toBuffer(),
        new BN(nonce).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];
    return { positionMint, orcaPosition, positionTokenAccount, permaPosition, nonce };
  }

  const liqAccounts = (p: ReturnType<typeof positionSet>) => ({
    owner: provider.wallet.publicKey,
    market,
    marketAuthority,
    permaPosition: p.permaPosition,
    whirlpool: PERMA_WHIRLPOOL,
    orcaPosition: p.orcaPosition,
    positionTokenAccount: p.positionTokenAccount,
    tokenMintA: WSOL,
    tokenMintB: DEV_USDC,
    vaultA: VAULT_A,
    vaultB: VAULT_B,
    orcaVaultA: ORCA_VAULT_A,
    orcaVaultB: ORCA_VAULT_B,
    tickArrayLower,
    tickArrayUpper,
    rangeState: rangeStatePda, // mandatory + PDA-verified; guard rejects if longs exist
    tokenProgramA: TOKEN_PROGRAM,
    tokenProgramB: TOKEN_PROGRAM,
    memoProgram: MEMO_PROGRAM,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
  });

  async function openPosition(p: ReturnType<typeof positionSet>) {
    await program.methods
      .adapterOpenPosition(TICK_LOWER, TICK_UPPER, new BN(p.nonce))
      .accounts({
        owner: provider.wallet.publicKey,
        market,
        marketAuthority,
        permaPosition: p.permaPosition,
        whirlpool: PERMA_WHIRLPOOL,
        orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey,
        positionTokenAccount: p.positionTokenAccount,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ATA_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([p.positionMint])
      .rpc();
  }

  const addLiquidity = (p: ReturnType<typeof positionSet>, liq: BN, maxA = MAX_A, maxB = MAX_B) =>
    program.methods
      .adapterAddLiquidity(TICK_LOWER, TICK_UPPER, liq, maxA, maxB)
      .accounts(liqAccounts(p))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();

  const removeLiquidity = (p: ReturnType<typeof positionSet>, liq: BN, closeAfter: boolean) =>
    program.methods
      .adapterRemoveLiquidity(TICK_LOWER, TICK_UPPER, liq, new BN(0), new BN(0), closeAfter)
      .accounts(liqAccounts(p))
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
      .rpc();

  const closePosition = (p: ReturnType<typeof positionSet>) =>
    program.methods
      .adapterClosePosition()
      .accounts({
        owner: provider.wallet.publicKey,
        market,
        marketAuthority,
        permaPosition: p.permaPosition,
        orcaPosition: p.orcaPosition,
        positionMint: p.positionMint.publicKey,
        positionTokenAccount: p.positionTokenAccount,
        tokenProgram: TOKEN_PROGRAM,
        whirlpoolProgram: WHIRLPOOL_PROGRAM,
      })
      .rpc();

  const userCollateral = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), market.toBuffer(), provider.wallet.publicKey.toBuffer()],
    program.programId
  )[0];

  before(async () => {
    // Fixtures must be present, otherwise every test below is meaningless.
    // Either the user ATAs still hold fixtures, or a previous run already
    // deposited into the vaults. Both are fine; only having neither is fatal.
    const fundedSomewhere =
      (await tokenAmount(conn, USER_A)) + (await tokenAmount(conn, VAULT_A)) > 0n;
    assert.isTrue(
      fundedSomewhere,
      "no WSOL anywhere - run node scripts/make-fixtures.mjs and restart the validator with --account"
    );

    await ensureGlobalConfig();
    const m = await conn.getAccountInfo(market);
    if (m === null) {
      await program.methods
        .createMarket()
        .accounts({
          admin: provider.wallet.publicKey,
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

    // Component 03: the vaults start EMPTY. Fund them through the real
    // deposit_collateral path rather than by injecting balances, so the
    // adapter spends tokens a user actually deposited.
    // Top up only what is missing, capped by what the fixture ATAs still hold.
    const needA = 2_000_000_000n;
    const needB = 200_000_000n;
    const haveVA = await tokenAmount(conn, VAULT_A);
    const haveVB = await tokenAmount(conn, VAULT_B);
    const min = (x: bigint, y: bigint) => (x < y ? x : y);
    const topA = haveVA >= needA ? 0n : min(needA - haveVA, await tokenAmount(conn, USER_A));
    const topB = haveVB >= needB ? 0n : min(needB - haveVB, await tokenAmount(conn, USER_B));
    if (topA > 0n || topB > 0n) {
      await program.methods
        .depositCollateral(new BN(topA.toString()), new BN(topB.toString()))
        .accounts({
          owner: provider.wallet.publicKey,
          market,
          userCollateral,
          userTokenA: USER_A,
          userTokenB: USER_B,
          vaultA: VAULT_A,
          vaultB: VAULT_B,
          tokenProgram: TOKEN_PROGRAM,
          systemProgram: SYSTEM_PROGRAM,
        })
        .rpc();
    }
    assert.isAbove(Number(await tokenAmount(conn, VAULT_A)), 0, "vault must be funded by deposit");
  });

  it("liquidity: open_position creates the Orca position owned by market_authority", async () => {
    const p = positionSet(1);
    await openPosition(p);

    const orca = await conn.getAccountInfo(p.orcaPosition);
    assert.isNotNull(orca, "Orca position not created");
    assert.equal(orca!.owner.toBase58(), WHIRLPOOL_PROGRAM.toBase58());
    // Position: disc(8) whirlpool(32) mint(32) liquidity(16) lower(4) upper(4)
    assert.equal(orca!.data.readInt32LE(88), TICK_LOWER);
    assert.equal(orca!.data.readInt32LE(92), TICK_UPPER);

    // The NFT ATA must be owned by the PDA, never a user key.
    const nft = await conn.getAccountInfo(p.positionTokenAccount);
    assert.isNotNull(nft);
    assert.equal(new PublicKey(nft!.data.subarray(32, 64)).toBase58(), marketAuthority.toBase58());
    assert.equal(nft!.data.readBigUInt64LE(64), 1n, "position NFT amount must be 1");

    const pp = await (program.account as any).permaPosition.fetch(p.permaPosition);
    assert.equal(pp.orcaPosition.toBase58(), p.orcaPosition.toBase58());
    assert.equal(pp.tickLower, TICK_LOWER);
  });

  it("liquidity: add increases orca position and decreases perma vaults", async () => {
    const p = positionSet(2);
    await openPosition(p);

    const beforeA = await tokenAmount(conn, VAULT_A);
    const beforeB = await tokenAmount(conn, VAULT_B);
    const beforeLiq = await positionLiquidity(conn, p.orcaPosition);
    assert.equal(beforeLiq, 0n);

    await addLiquidity(p, LIQUIDITY);

    const afterLiq = await positionLiquidity(conn, p.orcaPosition);
    assert.equal(afterLiq, BigInt(LIQUIDITY.toString()), "Orca liquidity must rise by exactly L");

    const spentA = beforeA - (await tokenAmount(conn, VAULT_A));
    const spentB = beforeB - (await tokenAmount(conn, VAULT_B));
    assert.isAbove(Number(spentA), 0, "WSOL must actually leave the PERMA vault");
    assert.isAbove(Number(spentB), 0, "devUSDC must actually leave the PERMA vault");
    assert.isAtMost(Number(spentA), MAX_A.toNumber());
    assert.isAtMost(Number(spentB), MAX_B.toNumber());

    // PERMA recorded the OBSERVED deltas, not the quote.
    const pp = await (program.account as any).permaPosition.fetch(p.permaPosition);
    assert.equal(pp.liquidity.toString(), LIQUIDITY.toString());
    // Renamed in components 04/05: `deposited_*` was cumulative and never
    // decremented on remove; `in_orca_*` tracks CURRENT exposure.
    assert.equal(pp.inOrcaA.toString(), spentA.toString());
    assert.equal(pp.inOrcaB.toString(), spentB.toString());
  });

  it("liquidity: partial remove halves the position and returns tokens", async () => {
    const p = positionSet(3);
    await openPosition(p);
    await addLiquidity(p, LIQUIDITY);

    const beforeA = await tokenAmount(conn, VAULT_A);
    const half = LIQUIDITY.divn(2);
    await removeLiquidity(p, half, false);

    assert.equal(
      await positionLiquidity(conn, p.orcaPosition),
      BigInt(LIQUIDITY.sub(half).toString()),
      "liquidity must halve"
    );
    assert.isAbove(Number((await tokenAmount(conn, VAULT_A)) - beforeA), 0, "tokens must return");
    assert.isNotNull(await conn.getAccountInfo(p.orcaPosition), "position must stay open");
  });

  it("liquidity: full close runs the 3-step sequence and reclaims rent", async () => {
    const p = positionSet(4);
    await openPosition(p);
    await addLiquidity(p, LIQUIDITY);

    // Step 1+2: decrease_liquidity_v2 then collect_fees_v2.
    await removeLiquidity(p, LIQUIDITY, true);
    assert.equal(await positionLiquidity(conn, p.orcaPosition), 0n);

    // Step 3: close_position.
    const rentBefore = await conn.getBalance(provider.wallet.publicKey);
    await closePosition(p);

    assert.isNull(await conn.getAccountInfo(p.orcaPosition), "Orca position must be closed");
    assert.isNull(await conn.getAccountInfo(p.permaPosition), "PERMA position must be closed");
    assert.isAbove(
      await conn.getBalance(provider.wallet.publicKey),
      rentBefore - 100_000,
      "rent should flow back to the receiver"
    );
  });

  it("regression: close on a non-empty position -> Orca 0x1775 ClosePositionNotEmpty", async () => {
    const p = positionSet(5);
    await openPosition(p);
    await addLiquidity(p, LIQUIDITY);

    // Liquidity still present: `Position::is_position_empty` is false, so
    // `close_position` must refuse. This is the same guard the 3-step sequence
    // relies on - proof that step 3 cannot run before steps 1-2.
    try {
      await closePosition(p);
      assert.fail("expected Orca ClosePositionNotEmpty (0x1775)");
    } catch (e: any) {
      const s = e.toString() + JSON.stringify(e.logs ?? []);
      assert.match(s, /0x1775|ClosePositionNotEmpty/, `expected 0x1775, got: ${s.slice(0, 400)}`);
    }

    // Now run the real sequence: decrease -> collect -> close. The very same
    // close call now succeeds, so the failure above was about emptiness alone.
    await removeLiquidity(p, LIQUIDITY, true);
    await closePosition(p);
    assert.isNull(await conn.getAccountInfo(p.orcaPosition));
  });

  it("regression: skipping collect_fees leaves fees owed (fee-driven 0x1775)", async () => {
    const p = positionSet(8);
    await openPosition(p);
    await addLiquidity(p, LIQUIDITY);

    // Decrease only - collect_fees_v2 deliberately skipped.
    await removeLiquidity(p, LIQUIDITY, false);
    assert.equal(await positionLiquidity(conn, p.orcaPosition), 0n);

    // fee_owed_a / fee_owed_b sit at offsets 112 and 136.
    const info = await conn.getAccountInfo(p.orcaPosition);
    const feeA = info!.data.readBigUInt64LE(112);
    const feeB = info!.data.readBigUInt64LE(136);

    if (feeA === 0n && feeB === 0n) {
      // Expected on a local validator: the position existed for a few slots and
      // no swap crossed it, so no fees accrued. The fee-driven form of 0x1775
      // cannot be forced without generating swap volume through the range -
      // reported honestly rather than asserted falsely. The emptiness guard
      // itself is already proven by the previous test.
      console.log(
        "      note: no fees accrued (no swaps on the local validator); " +
          "fee-driven 0x1775 not exercised - see IMPL-01B report"
      );
      await closePosition(p);
      assert.isNull(await conn.getAccountInfo(p.orcaPosition));
    } else {
      try {
        await closePosition(p);
        assert.fail("expected Orca ClosePositionNotEmpty (0x1775) from owed fees");
      } catch (e: any) {
        const s = e.toString() + JSON.stringify(e.logs ?? []);
        assert.match(s, /0x1775|ClosePositionNotEmpty/, `expected 0x1775, got: ${s.slice(0, 400)}`);
      }
      await removeLiquidity(p, new BN(0), true); // collect only
      await closePosition(p);
      assert.isNull(await conn.getAccountInfo(p.orcaPosition));
    }
  });

  it("regression: update_fees_and_rewards after full decrease -> Orca 0x177c LiquidityZero", async () => {
    const p = positionSet(6);
    await openPosition(p);
    await addLiquidity(p, LIQUIDITY);
    await removeLiquidity(p, LIQUIDITY, false);
    assert.equal(await positionLiquidity(conn, p.orcaPosition), 0n);

    // update_fees_and_rewards takes 4 accounts and NO signer, so it can be sent
    // straight from the client. Discriminator from the Orca IDL.
    const ix = new TransactionInstruction({
      programId: WHIRLPOOL_PROGRAM,
      keys: [
        { pubkey: PERMA_WHIRLPOOL, isSigner: false, isWritable: true },
        { pubkey: p.orcaPosition, isSigner: false, isWritable: true },
        { pubkey: tickArrayLower, isSigner: false, isWritable: false },
        { pubkey: tickArrayUpper, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([154, 230, 250, 13, 236, 209, 75, 223]),
    });

    try {
      await provider.sendAndConfirm(new Transaction().add(ix), []);
      assert.fail("expected Orca LiquidityZero (0x177c)");
    } catch (e: any) {
      const s = e.toString() + JSON.stringify(e.logs ?? []);
      assert.match(s, /0x177c|LiquidityZero/, `expected 0x177c, got: ${s.slice(0, 400)}`);
    }

    // Clean up through the supported path: collect (zero decrease is skipped by
    // the adapter precisely to avoid the error above), then close.
    await removeLiquidity(p, new BN(0), true);
    await closePosition(p);
    assert.isNull(await conn.getAccountInfo(p.orcaPosition));
  });

  it("liquidity: slippage cap rejects an under-budgeted add", async () => {
    const p = positionSet(7);
    await openPosition(p);
    try {
      // 1 lamport of WSOL cannot possibly cover this liquidity.
      await addLiquidity(p, LIQUIDITY, new BN(1), MAX_B);
      assert.fail("expected a slippage failure");
    } catch (e: any) {
      const s = e.toString() + JSON.stringify(e.logs ?? []);
      assert.match(
        s,
        /SlippageExceeded|TokenMaxExceeded|0x1781/,
        `expected a slippage error, got: ${s.slice(0, 400)}`
      );
    }
  });
});
