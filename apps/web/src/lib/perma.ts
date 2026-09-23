import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import idl from "../idl/perma.json";
import type { Perma } from "../idl/perma";
import {
  LEG_LONG,
  LEG_SHORT,
  mintExpectsPriceUpdate,
  PERMA_PROGRAM_ID,
  PRICE_UPDATE,
  WHIRLPOOL_PROGRAM_ID,
} from "./constants";
import {
  marketAuthorityPda,
  marketPda,
  orcaPositionPda,
  permaPositionPda,
  premiumIndexPda,
  rangeStatePda,
  rangeVaultPda,
  userCollateralPda,
} from "./pda";

/**
 * The minimal wallet shape every instruction builder here needs — exactly
 * what `@solana/wallet-adapter-react`'s `useAnchorWallet()` returns.
 * Deliberately NOT `@coral-xyz/anchor`'s own `Wallet` export: that name
 * resolves to a Node-only class requiring a real `payer: Keypair`, which a
 * browser wallet-adapter connection can never provide. `AnchorProvider`'s
 * constructor accepts anything structurally matching this (its `payer`
 * field is optional on the provider-side interface).
 */
export interface PermaWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

const ATA_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/**
 * The single Anchor client module. Every instruction this app can send is
 * built here, and only here — no component constructs a raw `.methods.*`
 * call itself, so the LONG/SHORT `Option` branching (the single easiest way
 * to get this program's account list wrong) lives in exactly one place.
 */
export function getPermaProgram(
  connection: Connection,
  wallet: PermaWallet
): Program<Perma> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idl as Perma, provider);
}

export interface OpenLongMeta extends AccountMeta {}

/** `remainingAccounts` for LONG mint / withdraw: pubkey-only, never a signer. */
export function openLongsToRemainingAccounts(
  positions: { pubkey: PublicKey }[]
): OpenLongMeta[] {
  return positions.map((p) => ({
    pubkey: p.pubkey,
    isSigner: false,
    isWritable: false,
  }));
}

// --- deposit / withdraw ----------------------------------------------------

export async function buildDepositCollateralIx(
  program: Program<Perma>,
  args: {
    owner: PublicKey;
    market: PublicKey;
    userTokenA: PublicKey;
    userTokenB: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    amountA: bigint;
    amountB: bigint;
  }
) {
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  return program.methods
    .depositCollateral(new BN(args.amountA.toString()), new BN(args.amountB.toString()))
    .accountsPartial({
      owner: args.owner,
      market: args.market,
      userCollateral,
      userTokenA: args.userTokenA,
      userTokenB: args.userTokenB,
      vaultA: args.vaultA,
      vaultB: args.vaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildWithdrawCollateralIx(
  program: Program<Perma>,
  args: {
    owner: PublicKey;
    market: PublicKey;
    userTokenA: PublicKey;
    userTokenB: PublicKey;
    vaultA: PublicKey;
    vaultB: PublicKey;
    amountA: bigint;
    amountB: bigint;
    /** Every one of the owner's currently OPEN long PermaPosition accounts. */
    openLongs: { pubkey: PublicKey }[];
  }
) {
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  const [marketAuthority] = marketAuthorityPda(args.market);
  const [premiumIndex] = premiumIndexPda(args.market);
  return program.methods
    .withdrawCollateral(
      new BN(args.amountA.toString()),
      new BN(args.amountB.toString())
    )
    .accountsPartial({
      owner: args.owner,
      market: args.market,
      marketAuthority,
      userCollateral,
      userTokenA: args.userTokenA,
      userTokenB: args.userTokenB,
      vaultA: args.vaultA,
      vaultB: args.vaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
      premiumIndex,
    })
    .remainingAccounts(openLongsToRemainingAccounts(args.openLongs))
    .instruction();
}

// --- mint --------------------------------------------------------------

export interface MintShortArgs {
  leg: "short";
  owner: PublicKey;
  market: PublicKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokenMaxA: bigint;
  tokenMaxB: bigint;
  nonce: bigint;
  whirlpool: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  orcaVaultA: PublicKey;
  orcaVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
  /** Fresh keypair; the client must co-sign the transaction with it. */
  positionMint: Keypair;
}

export interface MintLongArgs {
  leg: "long";
  owner: PublicKey;
  market: PublicKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  nonce: bigint;
  /** Read for its spot price only: the oracle deviation check (ADR-0004). */
  whirlpool: PublicKey;
  /** Every one of the owner's currently OPEN long PermaPosition accounts. */
  existingOpenLongs: { pubkey: PublicKey }[];
}

/**
 * Drop the P3 `price_update` meta so the instruction matches a pre-P3
 * `mint_position` (the program on Solana-devnet today).
 *
 * The committed IDL lists `price_update` as required and last among named
 * accounts, so Anchor will not build the instruction without it. That extra
 * meta is what the pre-P3 program rejects as `remaining_accounts` (6024).
 * LONG open-long metas are appended after the named accounts and must stay.
 * Refuse to remove anything that is not `PRICE_UPDATE`.
 */
function omitMintPriceUpdateAccount(
  ix: TransactionInstruction,
  remainingCount: number,
  priceUpdate: PublicKey
): TransactionInstruction {
  const index = ix.keys.length - remainingCount - 1;
  const meta = ix.keys[index];
  if (!meta || !meta.pubkey.equals(priceUpdate)) {
    throw new Error(
      "mint_position did not place price_update last among named accounts; refusing to drop a different account."
    );
  }
  const keys = ix.keys.filter((_, i) => i !== index);
  return new TransactionInstruction({
    programId: ix.programId,
    keys,
    data: ix.data,
  });
}

/**
 * `mint_position`. SHORT requires the full Orca account set and a
 * position-mint signer. LONG passes `null` for 14 Orca-specific fields (it
 * keeps `whirlpool` for the oracle spot check) and needs no extra signer — `remainingAccounts` must be exactly the
 * owner's existing open longs, or the tx fails `MissingOpenLong`.
 *
 * `price_update` is included only when `mintExpectsPriceUpdate()` is true
 * (localnet P3, or Solana-devnet after `NEXT_PUBLIC_MINT_EXPECTS_PRICE_UPDATE=1`).
 * Solana-devnet defaults to omitting it until that program is upgraded.
 * Pass `opts.priceUpdate` when a prior `post_update` created a fresh account.
 */
export async function buildMintPositionIx(
  program: Program<Perma>,
  args: MintShortArgs | MintLongArgs,
  opts?: { expectsPriceUpdate?: boolean; priceUpdate?: PublicKey }
) {
  const [marketAuthority] = marketAuthorityPda(args.market);
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  const [permaPosition] = permaPositionPda(args.market, args.owner, args.nonce);
  const [premiumIndex] = premiumIndexPda(args.market);
  const [rangeState] = rangeStatePda(args.market, args.tickLower, args.tickUpper);
  const [rangeVault] = rangeVaultPda(args.market, args.tickLower, args.tickUpper);
  const expectsPriceUpdate = opts?.expectsPriceUpdate ?? mintExpectsPriceUpdate();
  const priceUpdate = opts?.priceUpdate ?? PRICE_UPDATE;

  if (args.leg === "short") {
    const [orcaPosition] = orcaPositionPda(args.positionMint.publicKey);
    const [positionTokenAccount] = PublicKey.findProgramAddressSync(
      [
        marketAuthority.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        args.positionMint.publicKey.toBuffer(),
      ],
      ATA_PROGRAM_ID
    );
    const ix = await program.methods
      .mintPosition(
        LEG_SHORT,
        args.tickLower,
        args.tickUpper,
        new BN(args.liquidity.toString()),
        new BN(args.tokenMaxA.toString()),
        new BN(args.tokenMaxB.toString()),
        new BN(args.nonce.toString())
      )
      .accountsPartial({
        owner: args.owner,
        market: args.market,
        marketAuthority,
        userCollateral,
        permaPosition,
        premiumIndex,
        rangeState,
        rangeVault,
        whirlpool: args.whirlpool,
        orcaPosition,
        positionMint: args.positionMint.publicKey,
        positionTokenAccount,
        tokenMintA: args.tokenMintA,
        tokenMintB: args.tokenMintB,
        vaultA: args.vaultA,
        vaultB: args.vaultB,
        orcaVaultA: args.orcaVaultA,
        orcaVaultB: args.orcaVaultB,
        tickArrayLower: args.tickArrayLower,
        tickArrayUpper: args.tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ATA_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        priceUpdate,
      })
      .signers([args.positionMint])
      .instruction();
    return expectsPriceUpdate ? ix : omitMintPriceUpdateAccount(ix, 0, priceUpdate);
  }

  // LONG: every Orca-specific account but `whirlpool` is null; no position-mint signer.
  const ix = await program.methods
    .mintPosition(
      LEG_LONG,
      args.tickLower,
      args.tickUpper,
      new BN(args.liquidity.toString()),
      new BN(0),
      new BN(0),
      new BN(args.nonce.toString())
    )
    .accountsPartial({
      owner: args.owner,
      market: args.market,
      marketAuthority,
      userCollateral,
      permaPosition,
      premiumIndex,
      rangeState,
      rangeVault,
      whirlpool: args.whirlpool,
      orcaPosition: null,
      positionMint: null,
      positionTokenAccount: null,
      tokenMintA: null,
      tokenMintB: null,
      vaultA: null,
      vaultB: null,
      orcaVaultA: null,
      orcaVaultB: null,
      tickArrayLower: null,
      tickArrayUpper: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: null,
      memoProgram: null,
      whirlpoolProgram: null,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
      priceUpdate,
    })
    .remainingAccounts(openLongsToRemainingAccounts(args.existingOpenLongs))
    .instruction();
  return expectsPriceUpdate
    ? ix
    : omitMintPriceUpdateAccount(ix, args.existingOpenLongs.length, priceUpdate);
}

// --- burn ----------------------------------------------------------------

export interface BurnShortArgs {
  leg: "short";
  owner: PublicKey;
  market: PublicKey;
  nonce: bigint;
  tickLower: number;
  tickUpper: number;
  tokenMinA: bigint;
  tokenMinB: bigint;
  whirlpool: PublicKey;
  orcaPosition: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  orcaVaultA: PublicKey;
  orcaVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
}

export interface BurnLongArgs {
  leg: "long";
  owner: PublicKey;
  market: PublicKey;
  nonce: bigint;
  tickLower: number;
  tickUpper: number;
  vaultB: PublicKey;
}

/**
 * `burn_position`. A LONG burn still needs `vaultB` + `tokenProgram` — it
 * pays outstanding premium into `range_vault` as part of closing. Only the
 * pure-Orca fields go null on that leg.
 */
export async function buildBurnPositionIx(
  program: Program<Perma>,
  args: BurnShortArgs | BurnLongArgs
) {
  const [marketAuthority] = marketAuthorityPda(args.market);
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  const [permaPosition] = permaPositionPda(args.market, args.owner, args.nonce);
  const [premiumIndex] = premiumIndexPda(args.market);
  const [rangeState] = rangeStatePda(args.market, args.tickLower, args.tickUpper);
  const [rangeVault] = rangeVaultPda(args.market, args.tickLower, args.tickUpper);

  if (args.leg === "short") {
    return program.methods
      .burnPosition(new BN(args.tokenMinA.toString()), new BN(args.tokenMinB.toString()))
      .accountsPartial({
        owner: args.owner,
        market: args.market,
        marketAuthority,
        userCollateral,
        permaPosition,
        premiumIndex,
        rangeState,
        rangeVault,
        whirlpool: args.whirlpool,
        orcaPosition: args.orcaPosition,
        positionMint: args.positionMint,
        positionTokenAccount: args.positionTokenAccount,
        tokenMintA: args.tokenMintA,
        tokenMintB: args.tokenMintB,
        vaultA: args.vaultA,
        vaultB: args.vaultB,
        orcaVaultA: args.orcaVaultA,
        orcaVaultB: args.orcaVaultB,
        tickArrayLower: args.tickArrayLower,
        tickArrayUpper: args.tickArrayUpper,
        tokenProgram: TOKEN_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
        whirlpoolProgram: WHIRLPOOL_PROGRAM_ID,
      })
      .instruction();
  }

  return program.methods
    .burnPosition(new BN(0), new BN(0))
    .accountsPartial({
      owner: args.owner,
      market: args.market,
      marketAuthority,
      userCollateral,
      permaPosition,
      premiumIndex,
      rangeState,
      rangeVault,
      whirlpool: null,
      orcaPosition: null,
      positionMint: null,
      positionTokenAccount: null,
      tokenMintA: null,
      tokenMintB: null,
      vaultA: null,
      vaultB: args.vaultB,
      orcaVaultA: null,
      orcaVaultB: null,
      tickArrayLower: null,
      tickArrayUpper: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      memoProgram: null,
      whirlpoolProgram: null,
    })
    .instruction();
}

// --- settle ----------------------------------------------------------------

/**
 * `settle_premium`. No `Option` fields; same 11 accounts for both legs. The
 * SHORT leg requires `cranker === owner` on-chain (`Unauthorized` otherwise)
 * — this app only ever calls it with `cranker = owner` for a short, and
 * allows `cranker` to be any connected wallet for a long (permissionless).
 */
export async function buildSettlePremiumIx(
  program: Program<Perma>,
  args: {
    cranker: PublicKey;
    owner: PublicKey;
    market: PublicKey;
    nonce: bigint;
    tickLower: number;
    tickUpper: number;
    vaultB: PublicKey;
  }
) {
  const [marketAuthority] = marketAuthorityPda(args.market);
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  const [permaPosition] = permaPositionPda(args.market, args.owner, args.nonce);
  const [premiumIndex] = premiumIndexPda(args.market);
  const [rangeState] = rangeStatePda(args.market, args.tickLower, args.tickUpper);
  const [rangeVault] = rangeVaultPda(args.market, args.tickLower, args.tickUpper);

  return program.methods
    .settlePremium()
    .accountsPartial({
      cranker: args.cranker,
      owner: args.owner,
      market: args.market,
      marketAuthority,
      userCollateral,
      permaPosition,
      premiumIndex,
      rangeState,
      rangeVault,
      vaultB: args.vaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// --- lock / unlock (IDL parity — not wired to any screen) -----------------
//
// mint_position/burn_position already lock/unlock collateral internally as
// part of that single instruction (confirmed in programs/perma/src/lib.rs:
// position::open_short/open_long/close_short/close_long mutate locked_a/b
// directly). No Trade/Portfolio/Vault flow needs a standalone lock/unlock.
// These exist only so the client's instruction surface matches the IDL.

export async function buildLockCollateralIx(
  program: Program<Perma>,
  args: { owner: PublicKey; market: PublicKey; amountA: bigint; amountB: bigint }
) {
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  return program.methods
    .lockCollateral(new BN(args.amountA.toString()), new BN(args.amountB.toString()))
    .accountsPartial({ owner: args.owner, market: args.market, userCollateral })
    .instruction();
}

export async function buildUnlockCollateralIx(
  program: Program<Perma>,
  args: { owner: PublicKey; market: PublicKey; amountA: bigint; amountB: bigint }
) {
  const [userCollateral] = userCollateralPda(args.market, args.owner);
  return program.methods
    .unlockCollateral(new BN(args.amountA.toString()), new BN(args.amountB.toString()))
    .accountsPartial({ owner: args.owner, market: args.market, userCollateral })
    .instruction();
}

export { marketPda };
