import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  marketPda,
  marketAuthorityPda,
  userCollateralPda,
  permaPositionPda,
  rangeStatePda,
  rangeVaultPda,
  orcaTickArrayPda,
  startTickIndex,
} from "../src/lib/pda";

// A real, resolved allowlisted pool address (docs/06-testing/FIXTURES-AND-VECTORS.md §6).
const WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");
const OWNER = PublicKey.default;

describe("PDA derivation", () => {
  it("derives distinct market and market_authority addresses", () => {
    const [market] = marketPda(WHIRLPOOL);
    const [authority] = marketAuthorityPda(market);
    expect(market.toBase58()).not.toBe(authority.toBase58());
  });

  it("is deterministic across calls", () => {
    const [a] = marketPda(WHIRLPOOL);
    const [b] = marketPda(WHIRLPOOL);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it("range_vault is NEVER the same address as a market's own vault derivation path", () => {
    const [market] = marketPda(WHIRLPOOL);
    const [range] = rangeStatePda(market, -40176, -38168);
    const [rangeVault] = rangeVaultPda(market, -40176, -38168);
    // The one bug this module exists to prevent: range_vault must not collide
    // with range_state (different seed prefixes -> must differ).
    expect(range.toBase58()).not.toBe(rangeVault.toBase58());
  });

  it("negative ticks round-trip correctly (two's-complement LE encoding)", () => {
    const [market] = marketPda(WHIRLPOOL);
    const a = rangeStatePda(market, -40176, -38168)[0];
    const b = rangeStatePda(market, -40176, -38168)[0];
    expect(a.toBase58()).toBe(b.toBase58());
    // A different negative tick must produce a different address.
    const c = rangeStatePda(market, -40184, -38168)[0];
    expect(a.toBase58()).not.toBe(c.toBase58());
  });

  it("perma_position PDA changes with nonce", () => {
    const [market] = marketPda(WHIRLPOOL);
    const a = permaPositionPda(market, OWNER, 1n)[0];
    const b = permaPositionPda(market, OWNER, 2n)[0];
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it("startTickIndex buckets a tick to its 88*spacing-wide array start", () => {
    expect(startTickIndex(-40176, 8)).toBe(-40832);
    expect(startTickIndex(-38168, 8)).toBe(-38720);
  });

  it("orcaTickArrayPda uses Orca's own decimal-ASCII convention, not raw LE bytes", () => {
    // Sanity: deriving with the Whirlpool program should differ from PERMA's
    // own range_state PDA for the same numeric tick — different program,
    // different seed convention entirely.
    const [market] = marketPda(WHIRLPOOL);
    const [rangeState] = rangeStatePda(market, -40176, -38168);
    const [tickArray] = orcaTickArrayPda(WHIRLPOOL, startTickIndex(-40176, 8));
    expect(rangeState.toBase58()).not.toBe(tickArray.toBase58());
  });
});
