import { PublicKey } from "@solana/web3.js";
import type { MarketAccount, PositionWithPubkey } from "./accounts";
import { orcaTickArrayPda, startTickIndex } from "./pda";
import { LEG_SHORT } from "./constants";
import { orcaPositionPda } from "./pda";

const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/**
 * Derives every account a SHORT burn/settle needs beyond what's already in
 * `PositionWithPubkey`/`MarketAccount` — the position-token ATA and the two
 * Orca TickArray PDAs. Shared by Portfolio's Close/Settle actions so the
 * derivation logic (and its Orca-vs-PERMA seed convention pitfall) lives in
 * exactly one place.
 */
export function resolveShortOrcaAccounts(
  market: MarketAccount,
  marketAuthority: PublicKey,
  position: PositionWithPubkey
) {
  if (position.legType !== LEG_SHORT) {
    throw new Error("resolveShortOrcaAccounts called on a non-SHORT position");
  }
  const [positionTokenAccount] = PublicKey.findProgramAddressSync(
    [marketAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), position.positionMint.toBuffer()],
    ATA_PROGRAM_ID
  );
  const [tickArrayLower] = orcaTickArrayPda(
    market.whirlpool,
    startTickIndex(position.tickLower, market.tickSpacing)
  );
  const [tickArrayUpper] = orcaTickArrayPda(
    market.whirlpool,
    startTickIndex(position.tickUpper, market.tickSpacing)
  );
  return {
    whirlpool: market.whirlpool,
    orcaPosition: position.orcaPosition,
    positionMint: position.positionMint,
    positionTokenAccount,
    tokenMintA: market.tokenMintA,
    tokenMintB: market.tokenMintB,
    vaultA: market.vaultA,
    vaultB: market.vaultB,
    orcaVaultA: market.tokenVaultA,
    orcaVaultB: market.tokenVaultB,
    tickArrayLower,
    tickArrayUpper,
  };
}


/**
 * Derives every Orca-side account a NEW short mint needs, given the fresh
 * position-mint keypair the caller generated. Mirrors `resolveShortOrcaAccounts`
 * above but for a position that doesn't exist yet (no stored `orcaPosition`/
 * `positionMint` to read from).
 */
export function resolveMintShortOrcaAccounts(
  market: MarketAccount,
  marketAuthority: PublicKey,
  tickLower: number,
  tickUpper: number,
  positionMint: PublicKey
) {
  const [orcaPosition] = orcaPositionPda(positionMint);
  const [positionTokenAccount] = PublicKey.findProgramAddressSync(
    [marketAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), positionMint.toBuffer()],
    ATA_PROGRAM_ID
  );
  const [tickArrayLower] = orcaTickArrayPda(
    market.whirlpool,
    startTickIndex(tickLower, market.tickSpacing)
  );
  const [tickArrayUpper] = orcaTickArrayPda(
    market.whirlpool,
    startTickIndex(tickUpper, market.tickSpacing)
  );
  return {
    whirlpool: market.whirlpool,
    orcaPosition,
    positionTokenAccount,
    tokenMintA: market.tokenMintA,
    tokenMintB: market.tokenMintB,
    vaultA: market.vaultA,
    vaultB: market.vaultB,
    orcaVaultA: market.tokenVaultA,
    orcaVaultB: market.tokenVaultB,
    tickArrayLower,
    tickArrayUpper,
  };
}
