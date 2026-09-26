/**
 * Component 02 - Factory (Allowlisted Market).
 *
 * Covers the admin/allowlist authorization surface added on top of the
 * component-01 market creation path. Spec:
 * docs/02-mvp-components/02-factory-allowlisted-market.md
 *
 * GlobalConfig is a singleton PDA, so this suite tolerates it pre-existing and
 * skips the tests that require owning it. Run on a `--reset` validator for the
 * full set.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
/** The allowlisted pool. tick_spacing = 8, no active rewards. */
const PERMA_WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
/** A real Orca devnet pool that is NOT allowlisted. */
const OTHER_POOL = new PublicKey("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt");
/** A real devnet pool WITH active reward emissions (slots 0 and 1). */
const REWARDS_POOL = new PublicKey("EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEV_USDC = new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");

/** Documented Fair MVP defaults (07-premium-engine.md section A). */
const PREMIUM_RATE = 11_111;
const PREMIUM_MULTIPLIER = 1;
/** `state::risk_defaults` (ADR-0003). Demo values, not fair value. */
const LONG_MARGIN_HORIZON_SLOTS = 216_000;
const LONG_MARGIN_BUFFER_USDC = 1_000_000;

describe("factory: GlobalConfig, admin, and allowlist", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;

  const globalConfig = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    program.programId
  )[0];
  const marketPda = (pool: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("market"), pool.toBuffer()], program.programId)[0];
  const authorityPda = (market: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("market_authority"), market.toBuffer()],
      program.programId
    )[0];

  const market = marketPda(PERMA_WHIRLPOOL);
  const marketAuthority = authorityPda(market);

  /** True when THIS run created GlobalConfig, i.e. the ledger was fresh. */
  let ownsConfig = false;

  const createMarketAccounts = (over: Record<string, PublicKey> = {}) => ({
    admin: provider.wallet.publicKey,
    globalConfig,
    market,
    marketAuthority,
    whirlpool: PERMA_WHIRLPOOL,
    vaultA: VAULT_A,
    vaultB: VAULT_B,
    whirlpoolProgram: WHIRLPOOL_PROGRAM,
    systemProgram: SystemProgram.programId,
    ...over,
  });

  before(async () => {
    if ((await conn.getAccountInfo(globalConfig)) === null) {
      await program.methods
        .initializeGlobalConfig(PERMA_WHIRLPOOL)
        .accounts({
          admin: provider.wallet.publicKey,
          globalConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      ownsConfig = true;
    }
    if ((await conn.getAccountInfo(market)) === null) {
      await program.methods.createMarket().accounts(createMarketAccounts()).rpc();
    }
  });

  it("initialize_global_config records the admin and the single allowlisted pool", async () => {
    const gc = await (program.account as any).globalConfig.fetch(globalConfig);
    assert.equal(gc.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(gc.allowlistedWhirlpool.toBase58(), PERMA_WHIRLPOOL.toBase58());
  });

  it("initialize_global_config is not callable twice (singleton PDA)", async () => {
    try {
      await program.methods
        .initializeGlobalConfig(PERMA_WHIRLPOOL)
        .accounts({
          admin: provider.wallet.publicKey,
          globalConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected the second init to fail");
    } catch (e: any) {
      assert.match(e.toString(), /already in use|custom program error: 0x0/);
    }
  });

  it("create_market reads tick_spacing LIVE from the Whirlpool, not a constant", async () => {
    const raw = await conn.getAccountInfo(PERMA_WHIRLPOOL);
    const liveSpacing = raw!.data.readUInt16LE(41);

    const m = await (program.account as any).market.fetch(market);
    assert.equal(m.tickSpacing, liveSpacing, "Market.tick_spacing must equal the live pool value");
    assert.equal(liveSpacing, 8, "sanity: the allowlisted pool is spacing 8, not 64");
  });

  it("create_market copies mints and Orca vaults from the live Whirlpool", async () => {
    const m = await (program.account as any).market.fetch(market);
    assert.equal(m.whirlpool.toBase58(), PERMA_WHIRLPOOL.toBase58());
    assert.equal(m.whirlpoolsConfig.toBase58(), WHIRLPOOLS_CONFIG.toBase58());
    assert.equal(m.tokenMintA.toBase58(), WSOL.toBase58());
    assert.equal(m.tokenMintB.toBase58(), DEV_USDC.toBase58());

    // Orca vaults must match the pool account byte-for-byte.
    const raw = (await conn.getAccountInfo(PERMA_WHIRLPOOL))!.data;
    assert.equal(m.tokenVaultA.toBase58(), new PublicKey(raw.subarray(133, 165)).toBase58());
    assert.equal(m.tokenVaultB.toBase58(), new PublicKey(raw.subarray(213, 245)).toBase58());

    // PERMA vaults are the market_authority-owned ATAs.
    assert.equal(m.vaultA.toBase58(), VAULT_A.toBase58());
    assert.equal(m.vaultB.toBase58(), VAULT_B.toBase58());
    assert.isFalse(m.hasActiveRewards);
  });

  it("create_market sets the documented premium and risk defaults", async () => {
    const m = await (program.account as any).market.fetch(market);
    assert.equal(m.premiumRate.toNumber(), PREMIUM_RATE);
    assert.equal(m.premiumMultiplier.toNumber(), PREMIUM_MULTIPLIER);
    // ADR-0006: premium is 0.01 % of notional per hour (9,000 slots), and
    // margin is one day of it plus 1 USDC.
    assert.equal(m.longMarginHorizonSlots.toNumber(), LONG_MARGIN_HORIZON_SLOTS);
    assert.equal(m.longMarginBufferUsdc.toNumber(), LONG_MARGIN_BUFFER_USDC);
    assert.closeTo((9_000 * PREMIUM_RATE * PREMIUM_MULTIPLIER) / 1e12, 1e-4, 1e-8, "0.01 % of notional per hour");
  });

  it("rejects create_market from a non-admin signer", async () => {
    const intruder = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(intruder.publicKey, 2e9));

    // A pool with no market yet, so `init` cannot mask the auth failure.
    const freshMarket = marketPda(OTHER_POOL);
    try {
      await program.methods
        .createMarket()
        .accounts(
          createMarketAccounts({
            admin: intruder.publicKey,
            market: freshMarket,
            marketAuthority: authorityPda(freshMarket),
            whirlpool: OTHER_POOL,
          })
        )
        .signers([intruder])
        .rpc();
      assert.fail("expected Unauthorized");
    } catch (e: any) {
      assert.include(e.toString(), "Unauthorized");
    }
  });

  it("rejects an unallowlisted pool even from the admin", async () => {
    const freshMarket = marketPda(OTHER_POOL);
    try {
      await program.methods
        .createMarket()
        .accounts(
          createMarketAccounts({
            market: freshMarket,
            marketAuthority: authorityPda(freshMarket),
            whirlpool: OTHER_POOL,
          })
        )
        .rpc();
      assert.fail("expected PoolNotAllowlisted");
    } catch (e: any) {
      assert.include(e.toString(), "PoolNotAllowlisted");
    }
  });

  it("rejects an active-rewards pool, and the allowlist check fires first", async () => {
    // Confirm the fixture really does carry active rewards: reward_infos start
    // at 269, each 128 bytes; a non-default vault at +32 means active.
    const raw = (await conn.getAccountInfo(REWARDS_POOL))!.data;
    const active = [0, 1, 2].filter(
      (i) => !new PublicKey(raw.subarray(269 + i * 128 + 32, 269 + i * 128 + 64)).equals(PublicKey.default)
    );
    assert.isAbove(active.length, 0, "fixture pool must have active rewards");

    const freshMarket = marketPda(REWARDS_POOL);
    try {
      await program.methods
        .createMarket()
        .accounts(
          createMarketAccounts({
            market: freshMarket,
            marketAuthority: authorityPda(freshMarket),
            whirlpool: REWARDS_POOL,
          })
        )
        .rpc();
      assert.fail("expected the rewards pool to be rejected");
    } catch (e: any) {
      // PoolNotAllowlisted, not InvalidAsset: the allowlist is checked first.
      // The rewards guard itself is proven directly by tests/factory-rewards.ts.
      assert.include(e.toString(), "PoolNotAllowlisted");
    }
  });

  it("rejects a second create_market for the same pool", async () => {
    try {
      await program.methods.createMarket().accounts(createMarketAccounts()).rpc();
      assert.fail("expected MarketAlreadyExists / already-in-use");
    } catch (e: any) {
      assert.match(e.toString(), /already in use|MarketAlreadyExists|custom program error: 0x0/);
    }
  });

  // The `Pubkey::default()` allowlist guard needs an uninitialized
  // GlobalConfig, which this suite's `before` hook has already consumed. It is
  // covered on a fresh ledger by tests/factory-rewards.ts, and at unit level by
  // factory::tests::rejects_default_pubkey_as_allowlist_entry.
});
