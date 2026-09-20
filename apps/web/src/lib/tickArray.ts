import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { INITIALIZE_TICK_ARRAY_DISCRIMINATOR, WHIRLPOOL_PROGRAM_ID } from "./constants";
import { orcaTickArrayPda, startTickIndex } from "./pda";

/**
 * PERMA never creates Orca TickArrays itself (by design — see
 * docs/02-mvp-components/01-clmm-adapter-orca.md). If a user selects a range
 * whose TickArray doesn't exist yet, this module builds the real
 * `initialize_tick_array` CPI directly against the Whirlpool program — no
 * mock, no "coming soon" placeholder, matching COPY-DECK's rent-notice copy,
 * which describes a real one-time cost.
 */

export interface TickArrayStatus {
  lowerPda: PublicKey;
  upperPda: PublicKey;
  lowerExists: boolean;
  upperExists: boolean;
  /** True if lower and upper are the same account (a narrow same-array range). */
  sameArray: boolean;
}

export async function checkTickArraysExist(
  connection: Connection,
  whirlpool: PublicKey,
  tickLower: number,
  tickUpper: number,
  tickSpacing: number
): Promise<TickArrayStatus> {
  const [lowerPda] = orcaTickArrayPda(whirlpool, startTickIndex(tickLower, tickSpacing));
  const [upperPda] = orcaTickArrayPda(whirlpool, startTickIndex(tickUpper, tickSpacing));
  const sameArray = lowerPda.equals(upperPda);
  const infos = await connection.getMultipleAccountsInfo(
    sameArray ? [lowerPda] : [lowerPda, upperPda]
  );
  const lowerExists = infos[0] !== null;
  const upperExists = sameArray ? lowerExists : infos[1] !== null;
  return { lowerPda, upperPda, lowerExists, upperExists, sameArray };
}

/**
 * Finds the byte length of an existing TickArray for this pool, by sampling
 * nearby start-tick candidates around `tickCurrentIndex`. Used to compute
 * rent-exemption for a NEW array, rather than hand-computing the borsh size
 * (Orca's crate has both legacy `FixedTickArray` and newer `DynamicTickArray`
 * shapes — sampling a real account for the SAME pool guarantees the created
 * array matches whatever shape Orca already uses for it).
 *
 * Returns `null` if nothing can be sampled (e.g. a pool with zero TickArrays
 * created yet anywhere — possible on a freshly-created devnet market before
 * any position has ever been opened). Callers should fall back to
 * `FALLBACK_TICK_ARRAY_LEN` and log a warning in that case.
 */
export async function findSampleTickArrayLen(
  connection: Connection,
  whirlpool: PublicKey,
  tickCurrentIndex: number,
  tickSpacing: number,
  searchRadius = 8
): Promise<number | null> {
  const arraySpan = 88 * tickSpacing;
  const centerStart = startTickIndex(tickCurrentIndex, tickSpacing);
  const candidates: PublicKey[] = [];
  for (let i = -searchRadius; i <= searchRadius; i++) {
    const [pda] = orcaTickArrayPda(whirlpool, centerStart + i * arraySpan);
    candidates.push(pda);
  }
  const infos = await connection.getMultipleAccountsInfo(candidates);
  for (const info of infos) {
    if (info) return info.data.length;
  }
  return null;
}

/**
 * Captured once from a local-validator run as a last-resort fallback when
 * `findSampleTickArrayLen` finds nothing to sample (e.g. the very first
 * TickArray ever created for a pool on real devnet). If Orca's default
 * TickArray shape ever changes, this constant — and the rent estimate it
 * produces — could be wrong; that risk is accepted and documented rather
 * than silently guessed at. Treat a mismatch here as an ops smoke-test
 * finding, not a UI bug to chase.
 */
export const FALLBACK_TICK_ARRAY_LEN = 9988;

export function buildInitializeTickArrayIx(
  whirlpool: PublicKey,
  funder: PublicKey,
  tickArrayPda: PublicKey,
  startTick: number
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(INITIALIZE_TICK_ARRAY_DISCRIMINATOR),
    new BN(startTick).toTwos(32).toArrayLike(Buffer, "le", 4),
  ]);
  return new TransactionInstruction({
    programId: WHIRLPOOL_PROGRAM_ID,
    keys: [
      { pubkey: whirlpool, isSigner: false, isWritable: false },
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: tickArrayPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Instructions to create every missing TickArray for a range, funded by `funder`. */
export function buildMissingTickArrayIxs(
  whirlpool: PublicKey,
  funder: PublicKey,
  status: TickArrayStatus,
  tickLower: number,
  tickUpper: number,
  tickSpacing: number
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (!status.lowerExists) {
    ixs.push(
      buildInitializeTickArrayIx(
        whirlpool,
        funder,
        status.lowerPda,
        startTickIndex(tickLower, tickSpacing)
      )
    );
  }
  if (!status.upperExists && !status.sameArray) {
    ixs.push(
      buildInitializeTickArrayIx(
        whirlpool,
        funder,
        status.upperPda,
        startTickIndex(tickUpper, tickSpacing)
      )
    );
  }
  return ixs;
}
