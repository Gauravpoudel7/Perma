"use client";

import { Button } from "../primitives/Button";
import { formatBaseUnits } from "../../lib/format";
import { pendingPremiumNote, type PositionActions } from "../../lib/positionActions";

const DECIMALS_B = 6;

/**
 * Close / Settle buttons for one position. Flags come from `positionActions`;
 * this view does not decide them. Pending-premium copy sits under the buttons
 * so a size-0 short never offers a burn that the program will reject.
 */
export function CloseSettleView({
  actions,
  shortPayable,
  busy,
  disabled,
  disabledReason,
  onClose,
  onSettle,
}: {
  actions: PositionActions;
  shortPayable: bigint | null;
  busy: "close" | "settle" | null;
  disabled: boolean;
  disabledReason?: string;
  onClose: () => void;
  onSettle: () => void;
}) {
  const note = pendingPremiumNote(
    actions,
    shortPayable == null ? null : formatBaseUnits(shortPayable, DECIMALS_B, 6)
  );

  return (
    <div className="flex flex-col items-end gap-1 md:items-start" title={disabledReason}>
      {(actions.showSettle || actions.showClose) && (
        <div className="flex items-center gap-2">
          {actions.showSettle && (
            <Button variant="secondary" disabled={disabled || busy !== null} onClick={onSettle}>
              {busy === "settle" ? "Settling premium…" : "Settle"}
            </Button>
          )}
          {actions.showClose && (
            <Button variant="danger" disabled={disabled || busy !== null} onClick={onClose}>
              {busy === "close" ? "Closing…" : "Close"}
            </Button>
          )}
        </div>
      )}
      {note && (
        <p className="max-w-[11rem] text-caption text-right text-text-muted sm:max-w-[16rem] md:text-left">{note}</p>
      )}
    </div>
  );
}
