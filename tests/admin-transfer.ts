/**
 * P1 - `transfer_admin`: handing `GlobalConfig.admin` to another key.
 *
 * The point of the instruction is that the admin can become a Squads vault
 * without PERMA knowing what Squads is: the vault is just a pubkey that has to
 * sign. This suite proves that with a plain keypair standing in for the vault -
 * the on-chain contract is identical, and PERMA contains no multisig CPI
 * (`RUNBOOK-DEVNET.md` § Admin custody).
 *
 * Order-independence: the release gate runs the suite list twice on one ledger,
 * then reversed. The stand-in is derived from a fixed seed rather than
 * generated, so a run that crashed mid-handoff leaves the admin at a key THIS
 * run can still reconstruct and sign with; `before()` heals that, and `after()`
 * unconditionally restores the provider wallet.
 */
import * as anchor from "@coral-xyz/anchor";
import { EventParser, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert, AssertionError } from "chai";

/**
 * Every send in this suite confirms at `confirmed`, and so does every
 * simulation. The provider's default is `processed`, which is *ahead* of
 * `confirmed`: mixing the two lets a preflight run against a bank that has not
 * yet seen the transaction before it, which shows up as a phantom
 * `AccountNotInitialized` or `RangeNotEmpty`. One commitment, no races.
 */
const CONFIRMED = { commitment: "confirmed", preflightCommitment: "confirmed" } as const;

const PERMA_WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const VAULT_A = new PublicKey("3umaZKmQYDM2xbduPAa6LQWwj7Ngh4X6ZTRoNCfzNDdY");
const VAULT_B = new PublicKey("HNR1XRJoG6gLPDfk5Hwz8p5S7PTihFZkvHrsdxGWaYWR");

/** `state::risk_defaults` - what `after()` restores. */
const HORIZON = 1_000;
const BUFFER = 1_000_000;

/**
 * The stand-in "multisig". Fixed seed, never `Keypair.generate()`: `before()`
 * has to be able to sign as whoever a crashed run left in `GlobalConfig.admin`,
 * and it can only do that if that key is reproducible across processes.
 */
const STANDIN = Keypair.fromSeed(Uint8Array.from(Buffer.alloc(32, 0x91)));

describe("admin-transfer: GlobalConfig.admin handoff (P1)", () => {
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

  const adminOf = async () =>
    ((await (program.account as any).globalConfig.fetch(globalConfig)).admin as PublicKey);
  const marketState = () => (program.account as any).market.fetch(market);

  /** `signers` stays empty when `admin` is the provider wallet - it signs itself. */
  const transferAdmin = (newAdmin: PublicKey, admin = me, signers: Keypair[] = []) =>
    program.methods
      .transferAdmin(newAdmin)
      .accounts({ admin, globalConfig })
      .signers(signers)
      .rpc(CONFIRMED);

  const pause = (admin = me, signers: Keypair[] = []) =>
    program.methods.pauseMarket().accounts({ admin, globalConfig, market }).signers(signers).rpc(CONFIRMED);
  const unpause = (admin = me, signers: Keypair[] = []) =>
    program.methods.unpauseMarket().accounts({ admin, globalConfig, market }).signers(signers).rpc(CONFIRMED);
  const setRiskParams = (h: number, b: number, admin = me, signers: Keypair[] = []) =>
    program.methods
      .setMarketRiskParams(new BN(h), new BN(b))
      .accounts({ admin, globalConfig, market })
      .signers(signers)
      .rpc(CONFIRMED);

  const expectErr = async (p: Promise<unknown>, name: string) => {
    try {
      await p;
      assert.fail(`expected ${name}`);
    } catch (e: any) {
      if (e instanceof AssertionError) throw e;
      assert.include(e.toString(), name);
    }
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

  /** The stand-in must hold SOL to sign anything at all. */
  const fundStandin = async () => {
    if ((await conn.getBalance(STANDIN.publicKey)) >= LAMPORTS_PER_SOL / 2) return;
    await conn.confirmTransaction(
      await conn.requestAirdrop(STANDIN.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );
  };

  before(async () => {
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
    await fundStandin();
    // A crashed earlier run must not decide this one's starting state.
    if ((await adminOf()).equals(STANDIN.publicKey)) {
      await transferAdmin(me, STANDIN.publicKey, [STANDIN]);
    }
    assert.isTrue((await adminOf()).equals(me), "suite needs the provider wallet as admin");
  });

  it("a non-admin cannot transfer the admin away", async () => {
    await expectErr(transferAdmin(STANDIN.publicKey, STANDIN.publicKey, [STANDIN]), "Unauthorized");
    assert.isTrue((await adminOf()).equals(me), "nothing changed");
  });

  it("the all-zero pubkey is rejected - it would brick every admin path", async () => {
    await expectErr(transferAdmin(PublicKey.default), "InvalidAdmin");
    assert.isTrue((await adminOf()).equals(me));
  });

  it("transferring to self is a silent no-op and emits nothing", async () => {
    const sig = await transferAdmin(me);
    const events = await eventsOf(sig);
    assert.isEmpty(
      events.filter((e) => e.name === "adminTransferred"),
      "a retried ops script must not log a phantom handoff"
    );
    assert.isTrue((await adminOf()).equals(me));
  });

  describe("after the handoff", () => {
    let handoffSig: string;

    before(async () => {
      handoffSig = await transferAdmin(STANDIN.publicKey);
    });

    after(async () => {
      // Unconditional: whatever failed above, the next suite gets the provider
      // wallet back as admin, unpaused, at the demo risk parameters.
      await fundStandin();
      if ((await adminOf()).equals(STANDIN.publicKey)) {
        await unpause(STANDIN.publicKey, [STANDIN]).catch(() => {});
        await setRiskParams(HORIZON, BUFFER, STANDIN.publicKey, [STANDIN]).catch(() => {});
        await transferAdmin(me, STANDIN.publicKey, [STANDIN]);
      }
      await unpause().catch(() => {});
      await setRiskParams(HORIZON, BUFFER).catch(() => {});
      assert.isTrue((await adminOf()).equals(me), "suite must hand the admin back");
    });

    it("GlobalConfig.admin is the new key and AdminTransferred says so", async () => {
      assert.isTrue((await adminOf()).equals(STANDIN.publicKey));
      const events = await eventsOf(handoffSig);
      const hits = events.filter((e) => e.name === "adminTransferred");
      assert.equal(hits.length, 1, `got [${events.map((e) => e.name)}]`);
      const d = (hits[0] as any).data;
      assert.isTrue(d.globalConfig.equals(globalConfig));
      assert.isTrue(d.oldAdmin.equals(me));
      assert.isTrue(d.newAdmin.equals(STANDIN.publicKey));
    });

    it("the old admin can no longer pause or set risk params", async () => {
      await expectErr(pause(), "Unauthorized");
      await expectErr(setRiskParams(2_000, 2_000_000), "Unauthorized");
      await expectErr(transferAdmin(me), "Unauthorized");
      assert.isFalse((await marketState()).isPaused as boolean, "nothing changed");
    });

    it("the new admin holds the whole component-10 surface", async () => {
      await pause(STANDIN.publicKey, [STANDIN]);
      assert.isTrue((await marketState()).isPaused as boolean);
      await unpause(STANDIN.publicKey, [STANDIN]);
      assert.isFalse((await marketState()).isPaused as boolean);

      await setRiskParams(2_000, 2_000_000, STANDIN.publicKey, [STANDIN]);
      const m = await marketState();
      assert.equal(m.longMarginHorizonSlots.toNumber(), 2_000);
      assert.equal(m.longMarginBufferUsdc.toNumber(), 2_000_000);
      await setRiskParams(HORIZON, BUFFER, STANDIN.publicKey, [STANDIN]);
    });

    it("the new admin can hand it back", async () => {
      const sig = await transferAdmin(me, STANDIN.publicKey, [STANDIN]);
      assert.isTrue((await adminOf()).equals(me));
      const hits = (await eventsOf(sig)).filter(
        (e) => e.name === "adminTransferred"
      );
      assert.equal(hits.length, 1);
      assert.isTrue((hits[0] as any).data.oldAdmin.equals(STANDIN.publicKey));
      assert.isTrue((hits[0] as any).data.newAdmin.equals(me));
    });
  });
});
