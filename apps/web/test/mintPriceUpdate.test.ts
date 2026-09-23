import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair, type PublicKey } from "@solana/web3.js";
import { mintExpectsPriceUpdate, PRICE_UPDATE, WHIRLPOOL } from "../src/lib/constants";
import { buildMintPositionIx, getPermaProgram, type PermaWallet } from "../src/lib/perma";

function freshKey(): PublicKey {
  return Keypair.generate().publicKey;
}

function wallet(): { owner: Keypair; adapter: PermaWallet } {
  const owner = Keypair.generate();
  return {
    owner,
    adapter: {
      publicKey: owner.publicKey,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    },
  };
}

function programFor(adapter: PermaWallet) {
  return getPermaProgram(new Connection("http://127.0.0.1:8899", "confirmed"), adapter);
}

describe("mintExpectsPriceUpdate", () => {
  it("includes price_update on localnet and omits it on Solana-devnet", () => {
    expect(mintExpectsPriceUpdate("localnet")).toBe(true);
    expect(mintExpectsPriceUpdate("devnet")).toBe(false);
  });

  it("lets an explicit flag override the cluster default", () => {
    expect(mintExpectsPriceUpdate("devnet", "1")).toBe(true);
    expect(mintExpectsPriceUpdate("devnet", "true")).toBe(true);
    expect(mintExpectsPriceUpdate("localnet", "0")).toBe(false);
    expect(mintExpectsPriceUpdate("localnet", "false")).toBe(false);
    expect(mintExpectsPriceUpdate("devnet", "  ")).toBe(false);
  });
});

describe("buildMintPositionIx price_update gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function shortIx(expectsPriceUpdate?: boolean) {
    const { owner, adapter } = wallet();
    return buildMintPositionIx(
      programFor(adapter),
      {
        leg: "short",
        owner: owner.publicKey,
        market: freshKey(),
        tickLower: 16,
        tickUpper: 24,
        liquidity: 1_000_000n,
        tokenMaxA: 1n,
        tokenMaxB: 1n,
        nonce: 1n,
        whirlpool: WHIRLPOOL,
        tokenMintA: freshKey(),
        tokenMintB: freshKey(),
        vaultA: freshKey(),
        vaultB: freshKey(),
        orcaVaultA: freshKey(),
        orcaVaultB: freshKey(),
        tickArrayLower: freshKey(),
        tickArrayUpper: freshKey(),
        positionMint: Keypair.generate(),
      },
      expectsPriceUpdate === undefined ? undefined : { expectsPriceUpdate }
    );
  }

  async function longIx(openLong: PublicKey, expectsPriceUpdate: boolean) {
    const { owner, adapter } = wallet();
    return buildMintPositionIx(
      programFor(adapter),
      {
        leg: "long",
        owner: owner.publicKey,
        market: freshKey(),
        tickLower: 16,
        tickUpper: 24,
        liquidity: 1_000_000n,
        nonce: 1n,
        whirlpool: WHIRLPOOL,
        existingOpenLongs: [{ pubkey: openLong }],
      },
      { expectsPriceUpdate }
    );
  }

  function hasPriceUpdate(keys: { pubkey: PublicKey }[]) {
    return keys.filter((k) => k.pubkey.equals(PRICE_UPDATE)).length;
  }

  it("keeps price_update on the P3 account list", async () => {
    const ix = await shortIx(true);
    expect(hasPriceUpdate(ix.keys)).toBe(1);
    expect(ix.keys.at(-1)?.pubkey.equals(PRICE_UPDATE)).toBe(true);
  });

  it("drops only price_update for the pre-P3 account list", async () => {
    const withPrice = await shortIx(true);
    const without = await shortIx(false);
    expect(hasPriceUpdate(without.keys)).toBe(0);
    expect(without.keys.length).toBe(withPrice.keys.length - 1);
    expect(Buffer.from(without.data).equals(Buffer.from(withPrice.data))).toBe(true);
    expect(without.programId.equals(withPrice.programId)).toBe(true);
  });

  it("keeps a long's open-long remaining account after the drop", async () => {
    const openLong = freshKey();
    const ix = await longIx(openLong, false);
    expect(hasPriceUpdate(ix.keys)).toBe(0);
    expect(ix.keys.at(-1)?.pubkey.equals(openLong)).toBe(true);
    const kept = await longIx(openLong, true);
    const priceAt = kept.keys.findIndex((k) => k.pubkey.equals(PRICE_UPDATE));
    expect(priceAt).toBeGreaterThanOrEqual(0);
    expect(kept.keys[priceAt + 1]?.pubkey.equals(openLong)).toBe(true);
  });

  it("follows NEXT_PUBLIC_CLUSTER when the caller does not override", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    vi.stubEnv("NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE", "");
    expect(hasPriceUpdate((await shortIx()).keys)).toBe(1);

    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    expect(hasPriceUpdate((await shortIx()).keys)).toBe(0);

    vi.stubEnv("NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE", "1");
    expect(hasPriceUpdate((await shortIx()).keys)).toBe(1);
  });
});
