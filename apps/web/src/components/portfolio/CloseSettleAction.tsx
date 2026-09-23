"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CloseSettleView } from "./CloseSettleView";
import { useSendPermaTx } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { buildBurnPositionIx, buildSettlePremiumIx } from "../../lib/perma";
import { resolveShortOrcaAccounts } from "../../lib/resolvePosition";
import { marketAuthorityPda } from "../../lib/pda";
import { LEG_LONG, LEG_SHORT, STATUS_PENDING_PREMIUM } from "../../lib/constants";
import type { PositionActions } from "../../lib/positionActions";
import type { PositionWithPubkey } from "../../lib/accounts";

/**
 * Wires Portfolio Close / Settle to the existing instruction builders.
 *
 * Open short, and a long with nothing owed: Close → `burn_position`.
 * Open long above the U9 dust floor: Settle → `settle_premium` (stays open).
 * Pending Premium short: never Close. `burn_position` requires status Open
 * and returns `PositionAlreadyClosed`. Settle → `settle_premium` only when
 * `positionActions` says the range escrow can pay; otherwise the waiting line.
 */
export function CloseSettleAction({
  position,
  actions,
  shortPayable,
}: {
  position: PositionWithPubkey;
  actions: PositionActions;
  shortPayable: bigint | null;
}) {
  const { publicKey } = useWallet();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard({ allowWhilePaused: true });
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const [busy, setBusy] = useState<"close" | "settle" | null>(null);

  if (!market || !marketPubkey || !publicKey) return null;
  const [marketAuthority] = marketAuthorityPda(marketPubkey);

  const pending = position.status === STATUS_PENDING_PREMIUM;
  // Belt on the view-model. Pending Premium is not Open, so burn cannot succeed.
  // A pending long is not a protocol state; if one appears, offer neither action.
  const viewActions: PositionActions =
    pending && position.legType !== LEG_SHORT
      ? {
          showClose: false,
          showSettle: false,
          awaitingPremium: true,
          settleClosesAccount: false,
          partialSettle: false,
        }
      : pending
        ? { ...actions, showClose: false }
        : actions;

  async function handleClose() {
    if (position.status === STATUS_PENDING_PREMIUM) return;
    setBusy("close");
    try {
      const ix =
        position.legType === LEG_SHORT
          ? await buildBurnPositionIx(program, {
              leg: "short",
              owner: publicKey!,
              market: marketPubkey!,
              nonce: BigInt(position.nonce.toString()),
              tickLower: position.tickLower,
              tickUpper: position.tickUpper,
              tokenMinA: 0n,
              tokenMinB: 0n,
              ...resolveShortOrcaAccounts(market!, marketAuthority, position),
            })
          : await buildBurnPositionIx(program, {
              leg: "long",
              owner: publicKey!,
              market: marketPubkey!,
              nonce: BigInt(position.nonce.toString()),
              tickLower: position.tickLower,
              tickUpper: position.tickUpper,
              vaultB: market!.vaultB,
            });
      await send([ix], { successMessage: "Position closed. Premium settled to collateral." });
    } finally {
      setBusy(null);
    }
  }

  async function handleSettle() {
    const pendingShort = position.status === STATUS_PENDING_PREMIUM && position.legType === LEG_SHORT;
    if (position.legType !== LEG_LONG && !pendingShort) return;
    setBusy("settle");
    try {
      const ix = await buildSettlePremiumIx(program, {
        cranker: publicKey!,
        owner: publicKey!,
        market: marketPubkey!,
        nonce: BigInt(position.nonce.toString()),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        vaultB: market!.vaultB,
      });
      await send([ix], {
        successMessage: viewActions.settleClosesAccount
          ? "Position closed. Premium settled to collateral."
          : "Premium settled to collateral.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <CloseSettleView
      actions={viewActions}
      shortPayable={shortPayable}
      busy={busy}
      disabled={!canTransact || busy !== null}
      disabledReason={canTransact ? undefined : reason ?? undefined}
      onClose={() => void handleClose()}
      onSettle={() => void handleSettle()}
    />
  );
}
