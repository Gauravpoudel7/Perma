/**
 * Test pricing for suites that need premium to accrue within seconds (ADR-0006).
 *
 * The shipped market charges 0.01 % of notional per hour: on the demo range a
 * test-sized long owes ~0 µUSDC over the few slots a suite waits. These suites
 * switch the market to the ceilings (rate 1e6 × mult 1e3 = 0.1 % of notional per
 * slot) and a 1,000-slot horizon for their duration, then restore the shipped
 * values. Under test pricing, margin = ⌈notional⌉ + 1 USDC - the notional
 * analogue of Fair's `L + 1 USDC`.
 *
 * Notional uses the same tick math as the program and the web app
 * (`apps/web/src/lib/tickMath.ts`, a port of Orca's table).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { notionalQ64, rangeValueQ64 } from "../apps/web/src/lib/tickMath";

export const TEST_RATE = 1_000_000;
export const TEST_MULT = 1_000;
export const TEST_HORIZON = 1_000;
export const SHIPPED_RATE = 11_111;
export const SHIPPED_MULT = 1;
export const SHIPPED_HORIZON = 216_000;
export const BUFFER = 1_000_000;

const WHIRLPOOL = new PublicKey("2WUgXbAmhquXMLhqqUthztDaVYnG8Mmp57CkXNb5ym9G");

export function pricingAccounts(program: Program, admin: PublicKey) {
  const pda = (s: Buffer[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
  const market = pda([Buffer.from("market"), WHIRLPOOL.toBuffer()]);
  return {
    admin,
    globalConfig: pda([Buffer.from("global_config")]),
    market,
    premiumIndex: pda([Buffer.from("premium_index"), market.toBuffer()]),
  };
}

export async function setPricing(
  program: Program,
  admin: PublicKey,
  p: { rate: number; mult: number; horizon: number; buffer?: number }
) {
  const a = pricingAccounts(program, admin);
  await program.methods.setPremiumParams(new BN(p.rate), new BN(p.mult)).accounts(a).rpc();
  await program.methods
    .setMarketRiskParams(new BN(p.horizon), new BN(p.buffer ?? BUFFER))
    .accounts({ admin: a.admin, globalConfig: a.globalConfig, market: a.market })
    .rpc();
}

/**
 * `enable()` in the suite's `before()` once the market exists; `restore()` in
 * its last `after()`, after the suite has closed what it opened.
 */
export function testPricing(program: Program, provider: anchor.AnchorProvider) {
  const me = provider.wallet.publicKey;
  let enabled = false;
  return {
    enable: async () => {
      await setPricing(program, me, { rate: TEST_RATE, mult: TEST_MULT, horizon: TEST_HORIZON });
      enabled = true;
    },
    restore: async () => {
      if (enabled) await setPricing(program, me, { rate: SHIPPED_RATE, mult: SHIPPED_MULT, horizon: SHIPPED_HORIZON });
      enabled = false;
    },
  };
}

/** ⌈L × v / 2^64⌉: the notional the program's ceil-rounded paths use, in µUSDC. */
export function notionalCeil(liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  const q = notionalQ64(liquidity, tickLower, tickUpper);
  return (q + (1n << 64n) - 1n) >> 64n;
}

/** Margin under test pricing: ⌈notional⌉ + 1 USDC. */
export function testMargin(liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  return notionalCeil(liquidity, tickLower, tickUpper) + BigInt(BUFFER);
}

/** Largest L whose notional on the range is at most `usdc` µUSDC. */
export function liquidityFor(usdc: bigint, tickLower: number, tickUpper: number): bigint {
  return (usdc << 64n) / rangeValueQ64(tickLower, tickUpper);
}

/** What one settle over `slots` slots charges at test pricing (floor of the ceil'd scaled charge). */
export function testSettleCharge(slots: bigint, liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  const scaled = notionalQ64(liquidity, tickLower, tickUpper) * slots * BigInt(TEST_RATE) * BigInt(TEST_MULT);
  return ((scaled + (1n << 64n) - 1n) >> 64n) / 1_000_000_000_000n;
}

/**
 * Premium owed for `slots` slots at test pricing on `liquidity`, in µUSDC,
 * as the program's projection computes it (ceil).
 */
export function testPremium(slots: bigint, liquidity: bigint, tickLower: number, tickUpper: number): bigint {
  const scaled = notionalQ64(liquidity, tickLower, tickUpper) * slots * BigInt(TEST_RATE) * BigInt(TEST_MULT);
  const s = (scaled + (1n << 64n) - 1n) >> 64n;
  return (s + 1_000_000_000_000n - 1n) / 1_000_000_000_000n;
}
