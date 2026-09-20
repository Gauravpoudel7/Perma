import { Connection, PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type BN from "bn.js";
import type { Perma } from "../idl/perma";
import { LEG_LONG, STATUS_OPEN } from "./constants";
import { permaPositionPda } from "./pda";

/**
 * Typed shapes for what Anchor's `program.account.X.fetch` returns
 * (camelCase, BN for u64/u128/i128, number for i32/u16/u8, PublicKey for
 * pubkey fields) — matching `programs/perma/src/state.rs` field-for-field.
 */

export interface MarketAccount {
  whirlpool: PublicKey;
  whirlpoolsConfig: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  tickSpacing: number;
  hasActiveRewards: boolean;
  isPaused: boolean;
  authorityBump: number;
  bump: number;
  premiumRate: BN;
  premiumMultiplier: BN;
  longMarginHorizonSlots: BN;
  longMarginBufferUsdc: BN;
}

export interface UserCollateralAccount {
  market: PublicKey;
  owner: PublicKey;
  balanceA: BN;
  lockedA: BN;
  balanceB: BN;
  lockedB: BN;
  premiumOwedUsdc: BN;
  openPositions: number;
  bump: number;
  openLongs: number;
}

export interface PermaPositionAccount {
  market: PublicKey;
  owner: PublicKey;
  orcaPosition: PublicKey;
  positionMint: PublicKey;
  tickLower: number;
  tickUpper: number;
  liquidity: BN;
  inOrcaA: BN;
  inOrcaB: BN;
  lockedA: BN;
  lockedB: BN;
  legType: number;
  status: number;
  entryIndex: BN;
  accruedScaled: BN;
  entryAccQ64: BN;
  premiumReceivable: BN;
  nonce: BN;
  bump: number;
}

export interface RangePremiumStateAccount {
  market: PublicKey;
  tickLower: number;
  tickUpper: number;
  totalShortLiquidity: BN;
  totalLongLiquidity: BN;
  accPremiumPerShortQ64: BN;
  lastIndex: BN;
  premiumPool: BN;
  receivable: BN;
  dust: BN;
  bump: number;
}

export interface GlobalPremiumIndexAccount {
  currentIndex: BN;
  lastUpdateSlot: BN;
  bump: number;
}

export interface PositionWithPubkey extends PermaPositionAccount {
  pubkey: PublicKey;
}

export async function fetchMarket(
  program: Program<Perma>,
  market: PublicKey
): Promise<MarketAccount | null> {
  return (await program.account.market.fetchNullable(market)) as MarketAccount | null;
}

export async function fetchUserCollateral(
  program: Program<Perma>,
  userCollateral: PublicKey
): Promise<UserCollateralAccount | null> {
  return (await program.account.userCollateral.fetchNullable(
    userCollateral
  )) as UserCollateralAccount | null;
}

export async function fetchRangeState(
  program: Program<Perma>,
  rangeState: PublicKey
): Promise<RangePremiumStateAccount | null> {
  return (await program.account.rangePremiumState.fetchNullable(
    rangeState
  )) as RangePremiumStateAccount | null;
}

export async function fetchPremiumIndex(
  program: Program<Perma>,
  premiumIndex: PublicKey
): Promise<GlobalPremiumIndexAccount | null> {
  return (await program.account.globalPremiumIndex.fetchNullable(
    premiumIndex
  )) as GlobalPremiumIndexAccount | null;
}

/**
 * Every `PermaPosition` for this (market, owner), any leg, any status
 * (Open / Closed / Pending Premium).
 *
 * Uses Anchor's own `program.account.permaPosition.all(filters)` — NOT a
 * raw `connection.getProgramAccounts` call. That distinction matters here:
 * `UserCollateral` has the exact same `market`(offset 8) / `owner`(offset 40)
 * field layout as `PermaPosition` (both are `discriminator(8) + market(32) +
 * owner(32) + ...`), so a memcmp on those two offsets ALONE also matches the
 * caller's own `UserCollateral` account and fails to decode as a position.
 * `program.account.X.all()` prepends an account-discriminator memcmp at
 * offset 0 automatically, which is what actually disambiguates the two —
 * confirmed by running this against a real deployed program, where the raw
 * `getProgramAccounts` version failed with "Invalid account discriminator".
 */
export async function fetchAllPositionsForOwner(
  program: Program<Perma>,
  _connection: Connection,
  market: PublicKey,
  owner: PublicKey
): Promise<PositionWithPubkey[]> {
  const accounts = await program.account.permaPosition.all([
    { memcmp: { offset: 8, bytes: market.toBase58() } },
    { memcmp: { offset: 40, bytes: owner.toBase58() } },
  ]);
  return accounts.map(({ publicKey, account }) => ({
    pubkey: publicKey,
    ...(account as unknown as PermaPositionAccount),
  }));
}

/**
 * The exact `remainingAccounts` payload for LONG mint / withdraw: every
 * currently-OPEN long for this owner. Must match `UserCollateral.open_longs`
 * exactly or the on-chain gate fails `MissingOpenLong`.
 */
export async function fetchOpenLongsForOwner(
  program: Program<Perma>,
  connection: Connection,
  market: PublicKey,
  owner: PublicKey
): Promise<PositionWithPubkey[]> {
  const all = await fetchAllPositionsForOwner(program, connection, market, owner);
  return all.filter((p) => p.legType === LEG_LONG && p.status === STATUS_OPEN);
}

export { permaPositionPda };
