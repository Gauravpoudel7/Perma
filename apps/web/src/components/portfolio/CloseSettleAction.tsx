"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Button } from "../primitives/Button";
import { useSendPermaTx } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { buildBurnPositionIx, buildSettlePremiumIx } from "../../lib/perma";
import { resolveShortOrcaAccounts } from "../../lib/resolvePosition";
import { marketAuthorityPda } from "../../lib/pda";
import { LEG_LONG, LEG_SHORT } from "../../lib/constants";
import type { PositionWithPubkey } from "../../lib/accounts";

/**
 * "Close" for a short, or a long with nothing owed. "Settle" (routes to
 * `settle_premium`, not burn) for a long with a positive accrued amount.
 * This split isn't in COPY-DECK's verbatim table but is exactly what the
 * task's honesty-override action list specifies ("Close / Settle"); the two
 * buttons reuse COPY-DECK's exact "Closing…"/"Settling premium…" and
 * "Position closed…" strings.
 */
export function CloseSettleAction({
  position,
  hasAccrued,
}: {
  position: PositionWithPubkey;
  hasAccrued: boolean;
}) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard({ allowWhilePaused: true });
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const [busy, setBusy] = useState<"close" | "settle" | null>(null);

  if (!market || !marketPubkey || !publicKey) return null;
  const [marketAuthority] = marketAuthorityPda(marketPubkey);

  async function handleClose() {
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
      await send([ix], { successMessage: "Premium settled to collateral." });
    } finally {
      setBusy(null);
    }
  }

  const showSettle = position.legType === LEG_LONG && hasAccrued;

  return (
    <div className="flex items-center gap-2" title={canTransact ? undefined : reason ?? undefined}>
      {showSettle && (
        <Button
          variant="secondary"
          disabled={!canTransact || busy !== null}
          onClick={handleSettle}
        >
          {busy === "settle" ? "Settling premium…" : "Settle"}
        </Button>
      )}
      <Button variant="danger" disabled={!canTransact || busy !== null} onClick={handleClose}>
        {busy === "close" ? "Closing…" : "Close"}
      </Button>
    </div>
  );
}
