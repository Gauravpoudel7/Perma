import { LEG_LONG, LEG_SHORT, STATUS_PENDING_PREMIUM } from "./constants";
import { PERMA_ERROR_COPY } from "./errors";
import { isSettleable } from "./solvency";

const nothingToSettle = PERMA_ERROR_COPY.NothingToSettle;
if (!nothingToSettle) {
  throw new Error("NothingToSettle copy is missing.");
}

/**
 * Pending-premium short whose range escrow cannot pay yet.
 * The first sentence is `NothingToSettle`, the program error `settle_premium`
 * returns when `paid == 0`.
 */
export const AWAITING_PREMIUM_COPY = `${nothingToSettle} Waiting for a long to fund the range escrow.`;

/** Settle will pay the carried claim down to zero and the program closes the account. */
export const PENDING_SETTLE_CLOSES_COPY = "Pays this claim and closes the account.";

/** Position sheet sub-line while status is Pending Premium. Liquidity is already out. */
export const PENDING_PREMIUM_SHEET_SUBTITLE =
  "Liquidity is already withdrawn. Settle pays this claim from the range escrow when it has USDC.";

export interface PositionActionInput {
  legType: number;
  status: number;
  /** Display accrued, µUSDC. For a short this is the uncapped entitlement. */
  accrued: bigint;
  /**
   * What `settle_premium` would pay a short now (`min(owed, premium_pool)`).
   * `null` when `RangePremiumState` has not loaded — Settle stays hidden,
   * because an empty escrow returns `NothingToSettle`.
   */
  shortPayable: bigint | null;
}

export interface PositionActions {
  /** `burn_position`. Requires status Open, so never for Pending Premium. */
  showClose: boolean;
  /** `settle_premium`. Longs use the U9 dust floor. Pending-premium shorts use `paid > 0`. */
  showSettle: boolean;
  /** Pending-premium short (or any pending account) that cannot be settled yet. */
  awaitingPremium: boolean;
  /** A successful settle pays the claim to zero and the program closes the account. */
  settleClosesAccount: boolean;
  /** Escrow can pay, but not the whole claim. The account stays Pending Premium. */
  partialSettle: boolean;
}

/**
 * Portfolio Close / Settle for one position. The only producer of those flags.
 *
 * Open shorts and longs keep today's behavior: Close always, Settle only for
 * a long at or above `SETTLE_DUST_USDC_MICRO`. A Pending Premium short has
 * already left its liquidity; `burn_position` returns `PositionAlreadyClosed`,
 * so Close is not offered. Settle is offered only when the range escrow can
 * pay a non-zero amount. Any positive payment counts — unlike a long, this
 * short does not start accruing again, and the payment is what eventually
 * closes the account.
 */
export function positionActions(input: PositionActionInput): PositionActions {
  const isLong = input.legType === LEG_LONG;
  const pending = input.status === STATUS_PENDING_PREMIUM;

  if (!pending) {
    return {
      showClose: true,
      showSettle: isLong && isSettleable(input.accrued),
      awaitingPremium: false,
      settleClosesAccount: false,
      partialSettle: false,
    };
  }

  const payable = input.legType === LEG_SHORT && input.shortPayable != null ? input.shortPayable : 0n;
  const showSettle = payable > 0n;
  const settleClosesAccount = showSettle && input.accrued > 0n && payable >= input.accrued;
  return {
    showClose: false,
    showSettle,
    awaitingPremium: !showSettle,
    settleClosesAccount,
    partialSettle: showSettle && !settleClosesAccount,
  };
}

/** The sentence under the action, if this pending-premium row needs one. */
export function pendingPremiumNote(actions: PositionActions, payableUsdcLabel: string | null): string | null {
  if (actions.awaitingPremium) return AWAITING_PREMIUM_COPY;
  if (actions.partialSettle) {
    return payableUsdcLabel == null
      ? null
      : `Range escrow can pay ${payableUsdcLabel} USDC now. The rest stays owed.`;
  }
  if (actions.settleClosesAccount) return PENDING_SETTLE_CLOSES_COPY;
  return null;
}
