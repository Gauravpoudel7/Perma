"use client";

import { useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { NumberInput } from "../primitives/NumberInput";
import { Button } from "../primitives/Button";
import { SolvencyBlock, InsufficientBlock } from "./SolvencyBlock";
import { useSendPermaTx, fetchFreshOpenLongs } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { useOpenLongs } from "../../hooks/useOpenLongs";
import { buildWithdrawCollateralIx } from "../../lib/perma";
import { canWithdraw, projectedIndex, requiredFreeUsdc } from "../../lib/solvency";
import { parseToBaseUnits } from "../../lib/format";

const DECIMALS_B = 6;

/** COPY-DECK §4.3: CTA "Withdraw"; solvency-blocked live via `lib/solvency.ts`. */
export function WithdrawForm() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard({ allowWhilePaused: true });
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const userCollateral = useChainStore((s) => s.userCollateral);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const openLongs = useOpenLongs();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const preflight = useMemo(() => {
    if (!market || !userCollateral) return { ok: true, reason: null as "insufficient" | "solvency" | null };
    const freeB = BigInt(userCollateral.balanceB.toString());
    const amountB = parseToBaseUnits(amount || "0", DECIMALS_B);
    if (amountB > freeB) return { ok: false, reason: "insufficient" as const };

    const marketRiskFields = {
      longMarginHorizonSlots: BigInt(market.longMarginHorizonSlots.toString()),
      premiumRate: BigInt(market.premiumRate.toString()),
      premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
      longMarginBufferUsdc: BigInt(market.longMarginBufferUsdc.toString()),
    };
    const projected = premiumIndex
      ? projectedIndex(
          { currentIndex: BigInt(premiumIndex.currentIndex.toString()), lastUpdateSlot: BigInt(premiumIndex.lastUpdateSlot.toString()) },
          marketRiskFields.premiumRate,
          BigInt(premiumIndex.lastUpdateSlot.toString())
        )
      : 0n;
    const required = requiredFreeUsdc(
      BigInt(userCollateral.premiumOwedUsdc.toString()),
      openLongs.map((p) => ({
        accruedScaled: BigInt(p.accruedScaled.toString()),
        entryIndex: BigInt(p.entryIndex.toString()),
        liquidity: BigInt(p.liquidity.toString()),
      })),
      projected,
      marketRiskFields
    );
    if (!canWithdraw(freeB, amountB, required)) return { ok: false, reason: "solvency" as const };
    return { ok: true, reason: null as "insufficient" | "solvency" | null };
  }, [market, userCollateral, premiumIndex, openLongs, amount]);

  async function handleWithdraw() {
    if (!publicKey || !market || !marketPubkey) return;
    setBusy(true);
    try {
      const amountB = parseToBaseUnits(amount, DECIMALS_B);
      const userTokenA = getAssociatedTokenAddressSync(market.tokenMintA, publicKey);
      const userTokenB = getAssociatedTokenAddressSync(market.tokenMintB, publicKey);

      // Fresh (never store-cached) fetch — the store's positions list can be
      // up to 15s stale, and a stale remainingAccounts list fails MissingOpenLong.
      const freshOpenLongs = await fetchFreshOpenLongs(program, connection, marketPubkey, publicKey);

      const ix = await buildWithdrawCollateralIx(program, {
        owner: publicKey,
        market: marketPubkey,
        userTokenA,
        userTokenB,
        vaultA: market.vaultA,
        vaultB: market.vaultB,
        amountA: 0n,
        amountB,
        openLongs: freshOpenLongs,
      });
      await send([ix], { successMessage: "Withdrawal confirmed." });
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  const disabled = !canTransact || busy || !amount || !preflight.ok;

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h3 className="text-h4 mb-4 text-text-primary">Withdraw</h3>
      <NumberInput
        placeholder="0.00 USDC"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {preflight.reason === "insufficient" && <div className="mt-3"><InsufficientBlock /></div>}
      {preflight.reason === "solvency" && <div className="mt-3"><SolvencyBlock /></div>}
      <Button
        variant="secondary"
        className="mt-4 w-full"
        disabled={disabled}
        onClick={handleWithdraw}
        title={canTransact ? undefined : reason ?? undefined}
      >
        {busy ? "Confirm in your wallet" : "Withdraw"}
      </Button>
    </div>
  );
}
