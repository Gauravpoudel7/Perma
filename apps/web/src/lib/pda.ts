import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PERMA_PROGRAM_ID, TICK_ARRAY_SIZE, WHIRLPOOL_PROGRAM_ID } from "./constants";

/**
 * PDA derivation, seed-for-seed matching `programs/perma/src/state.rs::seeds`.
 * Every account read and every instruction builder in this app depends on
 * these being exact — get one of these wrong and the client will derive an
 * address the program will happily reject with a seeds-mismatch error, or
 * (worse) one that silently matches something else.
 *
 * PERMA's own PDAs (`range`, `range_vault`) encode ticks as raw 4-byte
 * little-endian, two's-complement for negative values. Orca's TickArray PDA
 * uses a COMPLETELY DIFFERENT convention: the decimal ASCII string of the
 * tick-array start index. Mixing these up is the single most likely copy-paste
 * bug in this file — see `orcaTickArrayPda` below, which is deliberately kept
 * in this same file so the contrast is visible next to `rangePda`.
 */

/** i32 -> 4-byte little-endian, two's-complement for negative ticks. */
function i32le(v: number): Buffer {
  return new BN(v).toTwos(32).toArrayLike(Buffer, "le", 4);
}

/** u64 (as bigint) -> 8-byte little-endian. */
function u64le(v: bigint): Buffer {
  return new BN(v.toString()).toArrayLike(Buffer, "le", 8);
}

function pda(seeds: (Buffer | Uint8Array)[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, PERMA_PROGRAM_ID);
}

export const globalConfigPda = () => pda([Buffer.from("global_config")]);

export const marketPda = (whirlpool: PublicKey) =>
  pda([Buffer.from("market"), whirlpool.toBuffer()]);

export const marketAuthorityPda = (market: PublicKey) =>
  pda([Buffer.from("market_authority"), market.toBuffer()]);

export const userCollateralPda = (market: PublicKey, owner: PublicKey) =>
  pda([Buffer.from("collateral"), market.toBuffer(), owner.toBuffer()]);

export const permaPositionPda = (
  market: PublicKey,
  owner: PublicKey,
  nonce: bigint
) =>
  pda([
    Buffer.from("perma_position"),
    market.toBuffer(),
    owner.toBuffer(),
    u64le(nonce),
  ]);

export const premiumIndexPda = (market: PublicKey) =>
  pda([Buffer.from("premium_index"), market.toBuffer()]);

/** Seeds use raw le_bytes — NOT Orca's TickArray to_string() convention. */
export const rangeStatePda = (
  market: PublicKey,
  tickLower: number,
  tickUpper: number
) =>
  pda([
    Buffer.from("range"),
    market.toBuffer(),
    i32le(tickLower),
    i32le(tickUpper),
  ]);

/**
 * The per-range premium escrow. A PERMA PDA — deliberately NOT the same
 * address as `Market.vault_b` (the collateral vault). Mixing these two up
 * would make premium escrow and collateral share one account.
 */
export const rangeVaultPda = (
  market: PublicKey,
  tickLower: number,
  tickUpper: number
) =>
  pda([
    Buffer.from("range_vault"),
    market.toBuffer(),
    i32le(tickLower),
    i32le(tickUpper),
  ]);

/** Orca's own tick-array bucket start, given any tick inside it. */
export function startTickIndex(tick: number, tickSpacing: number): number {
  const arraySpan = TICK_ARRAY_SIZE * tickSpacing;
  return Math.floor(tick / arraySpan) * arraySpan;
}

/**
 * Orca's TickArray PDA — a DIFFERENT program (the Whirlpool program) with a
 * DIFFERENT seed convention: the decimal ASCII string of the start tick, not
 * raw bytes. Do not reuse `rangeStatePda`'s `i32le` helper here.
 */
export function orcaTickArrayPda(
  whirlpool: PublicKey,
  startTick: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      whirlpool.toBuffer(),
      Buffer.from(startTick.toString()),
    ],
    WHIRLPOOL_PROGRAM_ID
  );
}

/** Orca's Position PDA, derived from the position-mint keypair (SHORT mint only). */
export function orcaPositionPda(positionMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), positionMint.toBuffer()],
    WHIRLPOOL_PROGRAM_ID
  );
}

export { i32le, u64le };
