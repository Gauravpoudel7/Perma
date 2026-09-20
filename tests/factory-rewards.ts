/**
 * Component 02 - guards that require an UNINITIALIZED GlobalConfig.
 *
 * GlobalConfig is a singleton PDA, so these cannot share a validator run with
 * tests/factory.ts. Run against a freshly reset ledger:
 *
 *   solana-test-validator --reset …   # see README / RELEASE-GATE section 3
 *   solana program deploy target/deploy/perma.so \
 *     --program-id target/deploy/perma-keypair.json -u localhost
 *   yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/factory-rewards.ts
 *
 * Proves two things the main suite structurally cannot:
 *
 *  1. `initialize_global_config` rejects the default pubkey.
 *  2. The `has_active_rewards` guard actually rejects a rewards-bearing pool.
 *     In normal operation the allowlist check fires first, so this guard is
 *     only reachable when the allowlisted pool ITSELF carries rewards - which
 *     is exactly the configuration set up here.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
/** Real devnet pool with active reward emissions in slots 0 and 1. */
const REWARDS_POOL = new PublicKey("EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");

describe("factory-rewards: guards needing a fresh GlobalConfig", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Perma as Program;
  const conn = provider.connection;

  const globalConfig = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    program.programId
  )[0];
  const market = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), REWARDS_POOL.toBuffer()],
    program.programId
  )[0];
  const marketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("market_authority"), market.toBuffer()],
    program.programId
  )[0];

  before(async function () {
    if ((await conn.getAccountInfo(globalConfig)) !== null) {
      console.log(
        "      SKIPPING: GlobalConfig already exists. Restart the validator " +
          "with --reset to run this suite."
      );
      this.skip();
    }
  });

  it("rejects the default pubkey as an allowlist entry", async () => {
    try {
      await program.methods
        .initializeGlobalConfig(PublicKey.default)
        .accounts({
          admin: provider.wallet.publicKey,
          globalConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected InvalidAllowlistEntry");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidAllowlistEntry");
    }
    // The failed init must not have created the account.
    assert.isNull(await conn.getAccountInfo(globalConfig));
  });

  it("rejects a pool with active rewards even when it IS the allowlisted pool", async () => {
    // Confirm the fixture carries active rewards: reward_infos start at 269,
    // 128 bytes each; a non-default vault at +32 means the slot is active.
    const raw = (await conn.getAccountInfo(REWARDS_POOL))!.data;
    const active = [0, 1, 2].filter(
      (i) =>
        !new PublicKey(raw.subarray(269 + i * 128 + 32, 269 + i * 128 + 64)).equals(
          PublicKey.default
        )
    );
    assert.isAbove(active.length, 0, "fixture pool must have active rewards");

    // Allowlist the rewards pool, so the allowlist check passes and execution
    // reaches the rewards guard.
    await program.methods
      .initializeGlobalConfig(REWARDS_POOL)
      .accounts({
        admin: provider.wallet.publicKey,
        globalConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const gc = await (program.account as any).globalConfig.fetch(globalConfig);
    assert.equal(gc.allowlistedWhirlpool.toBase58(), REWARDS_POOL.toBase58());

    try {
      await program.methods
        .createMarket()
        .accounts({
          admin: provider.wallet.publicKey,
          globalConfig,
          market,
          marketAuthority,
          whirlpool: REWARDS_POOL,
          vaultA: VAULT_A,
          vaultB: VAULT_B,
          whirlpoolProgram: WHIRLPOOL_PROGRAM,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected the active-rewards pool to be rejected");
    } catch (e: any) {
      // InvalidAsset is how the rewards rejection surfaces today. It must NOT
      // be PoolNotAllowlisted here - that would mean the allowlist masked it.
      const s = e.toString();
      assert.notInclude(s, "PoolNotAllowlisted", "allowlist must have passed");
      assert.include(s, "InvalidAsset");
    }
    assert.isNull(await conn.getAccountInfo(market), "no market may be created");
  });
});
