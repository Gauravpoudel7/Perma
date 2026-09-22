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
  Unauthorized: "You aren't authorized to do this.",
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
  InvalidRiskParams: "Those risk parameters would overflow the margin bound.",
};

export interface ParsedPermaError {
  name: string;
  message: string;
}

/** Walk WalletSendTransactionError.error / cause chains and collect logs + messages. */
function flattenThrown(e: unknown): { messages: string[]; logs: string[] } {
  const messages: string[] = [];
  const logs: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 6 && cur != null; depth++) {
    if (typeof cur !== "object") {
      messages.push(String(cur));
      break;
    }
    const o = cur as {
      message?: unknown;
      logs?: unknown;
      error?: unknown;
      cause?: unknown;
      name?: unknown;
    };
    if (Array.isArray(o.logs)) {
      for (const line of o.logs) if (typeof line === "string") logs.push(line);
    }
    if (typeof o.message === "string" && o.message.trim()) messages.push(o.message);
    else if (typeof o.name === "string" && o.name.trim()) messages.push(o.name);
    cur = o.error ?? o.cause ?? null;
  }
  return { messages, logs };
}

/**
 * Extracts a `PermaError` name from a thrown transaction error, falling back
 * to a raw-message scan for errors Anchor's own parser can't decode (e.g. an
 * unmapped Orca error like `ClosePositionNotEmpty`/`LiquidityZero`, or a
 * wallet-adapter rejection before anything reached the chain).
 *
 * Message text does NOT include "Nothing was changed." — `useSendPermaTx`
 * appends that once on the toast.
 */
export function parseAnchorError(e: unknown): ParsedPermaError {
  const flat = flattenThrown(e);
  const logs = flat.logs.length
    ? flat.logs
    : ((e as { logs?: string[] })?.logs ?? []);
  const anchorErr = AnchorError.parse(logs);
  const name = anchorErr?.error.errorCode.code;
  const mapped = name ? PERMA_ERROR_COPY[name] : undefined;
  if (name && mapped) {
    return { name, message: mapped };
  }

  const raw = flat.messages.join(" | ") || (e instanceof Error ? e.message : String(e));
  for (const knownName of Object.keys(PERMA_ERROR_COPY)) {
    const knownMessage = PERMA_ERROR_COPY[knownName];
    if (knownMessage && raw.includes(knownName)) {
      return { name: knownName, message: knownMessage };
    }
  }
  // Scan program logs for known error names too (simulation failures).
  const logBlob = logs.join("\n");
  for (const knownName of Object.keys(PERMA_ERROR_COPY)) {
    const knownMessage = PERMA_ERROR_COPY[knownName];
    if (knownMessage && logBlob.includes(knownName)) {
      return { name: knownName, message: knownMessage };
    }
  }

  if (/user rejected/i.test(raw)) {
    return { name: "UserRejected", message: "Transaction cancelled." };
  }

  // Every shape a "this wallet has no tokens" failure takes on localnet: the
  // SPL token program's own error (0x1), a missing ATA, a rent-exempt shortfall,
  // or the runtime's debit message — each seen nested inside
  // WalletSendTransactionError's generic "Unexpected error".
  const blob = `${raw}\n${logBlob}`;
  if (
    /insufficient (funds|lamports)/i.test(blob) ||
    /insufficient funds for rent/i.test(blob) ||
    /Attempt to debit an account but found no record of a prior credit/i.test(blob) ||
    /custom program error: 0x1\b/.test(blob) ||
    /could not find account/i.test(blob)
  ) {
    return {
      name: "WalletInsufficientFunds",
      message:
        "Not enough SOL or USDC in this wallet on localnet. Fixtures fund the CLI wallet only — import that key or regenerate fixtures for this address.",
    };
  }
  if (/Blockhash not found/i.test(raw) || /block height exceeded/i.test(raw)) {
    return { name: "BlockhashExpired", message: "Network was slow; the transaction expired. Try again." };
  }

  // Wallet adapter often wraps the real failure as message "Unexpected error"
  // with the useful text on `.error`. Prefer the deepest non-generic message.
  const useful =
    [...flat.messages].reverse().find((m) => m && !/^unexpected error$/i.test(m.trim())) ?? raw;
  const hint = useful.replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    name: "UnknownError",
    message: hint && !/^unexpected error$/i.test(hint) ? hint : "Unexpected error",
  };
}
