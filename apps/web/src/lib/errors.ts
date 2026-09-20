import { AnchorError } from "@coral-xyz/anchor";

/**
 * `PermaError` (programs/perma/src/errors.rs) → user-facing copy. Maps by
 * NAME (Anchor's own error carries it), never by the numeric on-chain code
 * (`6000 + declaration index`) and never the docs-only `0x..` catalog label.
 * Every toast the user sees for a failed transaction goes through this map —
 * per COPY-DECK §4.4, never a raw discriminant, never a generic
 * "Something went wrong."
 */
export const PERMA_ERROR_COPY: Record<string, string> = {
  InsufficientFunds:
    "You can only withdraw free collateral. Close a position to release locked funds.",
  InsolventWithdrawal:
    "This withdrawal would leave less than your open longs owe in premium. Settle or close a long first.",
  InsufficientCollateralForLoss:
    "Your free USDC can't cover the premium owed. Deposit more USDC, then settle or close.",
  PositionsOutstanding: "Collateral is locked by an open position. Close it before unlocking.",
  InvalidLegType: "Invalid position side.",
  PositionAlreadyClosed: "This position is already closed.",
  NoShortInventory:
    "No short liquidity in this range. A long needs existing short liquidity to open against.",
  InventoryInvariantViolated: "This action would break the range's short/long balance.",
  HarnessPathUnavailable: "This range has open longs and can't be modified this way.",
  NothingToSettle: "There is nothing to settle yet.",
  RangeStateMismatch: "The supplied range doesn't match this position's ticks.",
  PremiumPoolUnderfunded: "The premium pool can't cover this claim. Please report this.",
  ZeroAmount: "Enter an amount greater than zero.",
  MarketPaused: "Trading is paused. Open positions can still be closed.",
  PoolNotAllowlisted: "This pool isn't allowlisted for PERMA.",
  Unauthorized: "You aren't authorized to settle this position.",
  MarketAlreadyExists: "This market already exists.",
  InvalidAllowlistEntry: "Invalid allowlist configuration.",
  WrongWhirlpoolProgram: "Unexpected Whirlpool program.",
  WhirlpoolNotAllowlisted: "This Whirlpool isn't the allowlisted pool.",
  TickArrayNotInitialized: "This range needs a new tick array first.",
  TickNotAlignedToSpacing: "This range isn't aligned to the pool's tick spacing.",
  TickOutOfBounds: "This range is out of bounds.",
  PositionAuthorityMismatch: "Position account mismatch.",
  UnexpectedRemainingAccounts: "Unexpected extra accounts on this transaction.",
  SlippageExceeded: "Price moved past your slippage limit. Try again.",
  ClosePositionNotEmpty: "This position still has liquidity or fees to remove.",
  InvalidRange: "Invalid price range.",
  InvalidAsset: "Unexpected token account for this market.",
  MathOverflow: "This amount is too large to process.",
  InvalidWhirlpoolAccount: "Couldn't read the pool account.",
  InsolventMint: "Your free USDC can't cover this long's required margin.",
  MissingOpenLong: "Your open positions changed since this was prepared. Please retry.",
  TooManyOpenLongs: "You've reached the maximum of 8 open longs.",
};

export interface ParsedPermaError {
  name: string;
  message: string;
}

/**
 * Extracts a `PermaError` name from a thrown transaction error, falling back
 * to a raw-message scan for errors Anchor's own parser can't decode (e.g. an
 * unmapped Orca error like `ClosePositionNotEmpty`/`LiquidityZero`, or a
 * wallet-adapter rejection before anything reached the chain).
 */
export function parseAnchorError(e: unknown): ParsedPermaError {
  const logs: string[] = (e as { logs?: string[] })?.logs ?? [];
  const anchorErr = AnchorError.parse(logs);
  const name = anchorErr?.error.errorCode.code;
  const mapped = name ? PERMA_ERROR_COPY[name] : undefined;
  if (name && mapped) {
    return { name, message: mapped };
  }

  const raw = e instanceof Error ? e.message : String(e);
  for (const knownName of Object.keys(PERMA_ERROR_COPY)) {
    const knownMessage = PERMA_ERROR_COPY[knownName];
    if (knownMessage && raw.includes(knownName)) {
      return { name: knownName, message: knownMessage };
    }
  }

  if (/user rejected/i.test(raw)) {
    return { name: "UserRejected", message: "Transaction cancelled." };
  }

  return { name: "UnknownError", message: "Unexpected error. Nothing was changed." };
}
