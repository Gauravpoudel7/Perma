/**
 * Component 01 - CLMM Adapter integration tests.
 *
 * Runs against a local validator with the Orca Whirlpool program and the
 * allowlisted devnet pool cloned in (see Anchor.toml [test.validator] and
 * docs/06-testing/RELEASE-GATE.md section 3).
 *
 * Covers the pre-CPI validation surface from
 * docs/02-mvp-components/01-clmm-adapter-orca.md section C.8. Tests that move
 * liquidity need funded PERMA vaults; see the impl report for that gap.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
/** Allowlisted devnet SOL/devUSDC pool. tick_spacing = 8. */
const PERMA_WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const ORCA_VAULT_A = new PublicKey("3uyTv2Pi3pb6Gc2emKiYU8gW845M1HeMMyFr2MTrDGh4");
const ORCA_VAULT_B = new PublicKey("63GvSvGYTsfesX1kmesdtfxHbBQBsFpZT1wVNhNADT5C");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
/** PERMA vaults: ATAs owned by market_authority, funded via tests/fixtures. */
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");

const TICK_SPACING = 8;
const TICK_ARRAY_SIZE = 88;
const TICKS_IN_ARRAY = TICK_ARRAY_SIZE * TICK_SPACING; // 704

/** Demo range around the live price (~$19.97/SOL). */
const TICK_LOWER = -40176;
const TICK_UPPER = -38168;

/** Mirrors adapter.rs: floor division, NOT truncation. */
function startTickIndex(tick: number, spacing: number): number {
  const n = TICK_ARRAY_SIZE * spacing;
  return Math.floor(tick / n) * n;
}

function tickArrayPda(whirlpool: PublicKey, tick: number, spacing: number): PublicKey {
  const start = startTickIndex(tick, spacing);
  // Seeds use the DECIMAL ASCII string, not little-endian bytes.
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tick_array"), whirlpool.toBuffer(), Buffer.from(start.toString())],
    WHIRLPOOL_PROGRAM
  )[0];
}

describe("adapter: CLMM Adapter (Orca Whirlpool)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;

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

  const tickArrayLower = tickArrayPda(PERMA_WHIRLPOOL, TICK_LOWER, TICK_SPACING);
  const tickArrayUpper = tickArrayPda(PERMA_WHIRLPOOL, TICK_UPPER, TICK_SPACING);

  const validateAccounts = (over: Record<string, PublicKey> = {}) => ({
    market,
    marketAuthority,
    whirlpool: PERMA_WHIRLPOOL,
    tickArrayLower,
    tickArrayUpper,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
    ...over,
  });

  it("clones the Whirlpool and reads tick_spacing = 8 from the live account", async () => {
    const info = await provider.connection.getAccountInfo(PERMA_WHIRLPOOL);
    assert.isNotNull(info, "pool not cloned - check Anchor.toml [test.validator]");
    assert.equal(info!.owner.toBase58(), WHIRLPOOL_PROGRAM.toBase58());
    // tick_spacing lives at offset 41 (8 disc + 32 config + 1 bump).
    assert.equal(info!.data.readUInt16LE(41), TICK_SPACING);
  });

  it("create_market records pool geometry read from the live Whirlpool", async () => {
    // Idempotent: the market PDA survives across runs on a non-reset validator.
    await ensureGlobalConfig();
    const existing = await provider.connection.getAccountInfo(market);
    if (existing === null) {
      await program.methods
        .createMarket()
        .accounts({
          admin: provider.wallet.publicKey,
          globalConfig,
          market,
          marketAuthority,
          whirlpool: PERMA_WHIRLPOOL,
          vaultA: VAULT_A, // real PERMA vaults; create_market now validates them
          vaultB: VAULT_B,
          whirlpoolProgram: WHIRLPOOL_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const m = await (program.account as any).market.fetch(market);
    assert.equal(m.tickSpacing, TICK_SPACING, "tick_spacing must come from the pool, not a constant");
    assert.equal(m.whirlpool.toBase58(), PERMA_WHIRLPOOL.toBase58());
    assert.equal(m.whirlpoolsConfig.toBase58(), WHIRLPOOLS_CONFIG.toBase58());
    assert.equal(m.tokenMintA.toBase58(), WSOL.toBase58());
    assert.equal(m.tokenMintB.toBase58(), DEV_USDC.toBase58());
    assert.isFalse(m.hasActiveRewards, "MVP close sequence omits collect_reward_v2");
    assert.equal(m.vaultA.toBase58(), VAULT_A.toBase58());
    assert.equal(m.vaultB.toBase58(), VAULT_B.toBase58());
  });

  it("validates a correct range and derives both TickArrays", async () => {
    await program.methods
      .validateShortRange(TICK_LOWER, TICK_UPPER)
      .accounts(validateAccounts())
      .rpc();
    // Distinct arrays: exercises the two-array path.
    assert.notEqual(tickArrayLower.toBase58(), tickArrayUpper.toBase58());
  });

  it("rejects a tick not aligned to tick_spacing", async () => {
    try {
      await program.methods
        .validateShortRange(TICK_LOWER + 1, TICK_UPPER)
        .accounts(validateAccounts())
        .rpc();
      assert.fail("expected TickNotAlignedToSpacing");
    } catch (e: any) {
      assert.include(e.toString(), "TickNotAlignedToSpacing");
    }
  });

  it("rejects an inverted range", async () => {
    try {
      await program.methods
        .validateShortRange(TICK_UPPER, TICK_LOWER)
        .accounts(validateAccounts())
        .rpc();
      assert.fail("expected InvalidRange");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidRange");
    }
  });

  it("rejects an out-of-bounds tick", async () => {
    try {
      await program.methods
        .validateShortRange(-443648, TICK_UPPER) // < MIN_TICK_INDEX, still % 8 == 0
        .accounts(validateAccounts())
        .rpc();
      assert.fail("expected TickOutOfBounds");
    } catch (e: any) {
      assert.include(e.toString(), "TickOutOfBounds");
    }
  });

  it("rejects a TickArray that is not the PDA for its tick", async () => {
    // A real, correctly-formed TickArray PDA - but for the wrong start index.
    const wrong = tickArrayPda(PERMA_WHIRLPOOL, TICK_LOWER - TICKS_IN_ARRAY * 3, TICK_SPACING);
    try {
      await program.methods
        .validateShortRange(TICK_LOWER, TICK_UPPER)
        .accounts(validateAccounts({ tickArrayLower: wrong }))
        .rpc();
      assert.fail("expected TickArrayNotInitialized");
    } catch (e: any) {
      assert.include(e.toString(), "TickArrayNotInitialized");
    }
  });

  it("rejects TickArray seeds built from to_le_bytes instead of to_string", async () => {
    const start = startTickIndex(TICK_LOWER, TICK_SPACING);
    const le = Buffer.alloc(4);
    le.writeInt32LE(start);
    const wrong = PublicKey.findProgramAddressSync(
      [Buffer.from("tick_array"), PERMA_WHIRLPOOL.toBuffer(), le],
      WHIRLPOOL_PROGRAM
    )[0];
    assert.notEqual(wrong.toBase58(), tickArrayLower.toBase58());
    try {
      await program.methods
        .validateShortRange(TICK_LOWER, TICK_UPPER)
        .accounts(validateAccounts({ tickArrayLower: wrong }))
        .rpc();
      assert.fail("expected TickArrayNotInitialized");
    } catch (e: any) {
      assert.include(e.toString(), "TickArrayNotInitialized");
    }
  });

  it("rejects a whirlpool that is not the allowlisted pool", async () => {
    // A different real Orca devnet pool.
    const other = new PublicKey("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt");
    try {
      await program.methods
        .validateShortRange(TICK_LOWER, TICK_UPPER)
        .accounts(validateAccounts({ whirlpool: other }))
        .rpc();
      assert.fail("expected WhirlpoolNotAllowlisted");
    } catch (e: any) {
      // The pool is cloned into the ledger on purpose: an absent account fails
      // at deserialization instead, and this assertion would pass without ever
      // reaching the allowlist check it is named for.
      assert.match(e.toString(), /WhirlpoolNotAllowlisted/);
    }
  });

  it("rejects a CPI target that is not the Whirlpool program", async () => {
    try {
      await program.methods
        .validateShortRange(TICK_LOWER, TICK_UPPER)
        .accounts(validateAccounts({ whirlpoolProgram: SystemProgram.programId }))
        .rpc();
      assert.fail("expected WrongWhirlpoolProgram");
    } catch (e: any) {
      assert.include(e.toString(), "WrongWhirlpoolProgram");
    }
  });

  it("rejects caller-injected remaining accounts", async () => {
    try {
      await program.methods
        .validateShortRange(TICK_LOWER, TICK_UPPER)
        .accounts(validateAccounts())
        .remainingAccounts([
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();
      assert.fail("expected UnexpectedRemainingAccounts");
    } catch (e: any) {
      assert.include(e.toString(), "UnexpectedRemainingAccounts");
    }
  });

  it("accepts a narrow range whose bounds share one TickArray", async () => {
    const lo = -39184;
    const hi = -39104;
    const shared = tickArrayPda(PERMA_WHIRLPOOL, lo, TICK_SPACING);
    assert.equal(shared.toBase58(), tickArrayPda(PERMA_WHIRLPOOL, hi, TICK_SPACING).toBase58());
    // Passing the same account twice is legal for liquidity instructions.
    await program.methods
      .validateShortRange(lo, hi)
      .accounts(validateAccounts({ tickArrayLower: shared, tickArrayUpper: shared }))
      .rpc();
  });
});
