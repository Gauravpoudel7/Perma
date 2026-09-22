"use client";

import { useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { NumberInput } from "../primitives/NumberInput";
import { Button } from "../primitives/Button";
import { SolvencyBlock, InsufficientBlock } from "./SolvencyBlock";
import { VaultReviewSheet } from "./VaultReviewSheet";
import { useSendPermaTx, fetchFreshOpenLongs } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { useRequiredFreeUsdc } from "../../hooks/useRequiredFreeUsdc";
import { buildWithdrawCollateralIx } from "../../lib/perma";
import { canWithdraw } from "../../lib/solvency";
import { formatBaseUnits, parseToBaseUnits } from "../../lib/format";

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
  const view = useRequiredFreeUsdc();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  // The same `canWithdraw(free, amount, required)` gate as before; `required`
  // now comes from the shared hook instead of a local copy of the formula.
  const preflight = useMemo(() => {
    if (!view) return { ok: true, reason: null as "insufficient" | "solvency" | null };
    const amountB = parseToBaseUnits(amount || "0", DECIMALS_B);
    if (amountB > view.freeUsdc) return { ok: false, reason: "insufficient" as const };
    if (!canWithdraw(view.freeUsdc, amountB, view.required)) return { ok: false, reason: "solvency" as const };
    return { ok: true, reason: null as "insufficient" | "solvency" | null };
  }, [view, amount]);

  // What can leave while every open long stays covered — `free − required`, floored at 0.
  const withdrawable = view ? (view.freeUsdc > view.required ? view.freeUsdc - view.required : 0n) : null;

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
      const sig = await send([ix], { successMessage: "Withdrawal confirmed." });
      if (!sig) return;
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  const hasAmount = !!amount && Number(amount) > 0;
  const disabledReason = !canTransact ? reason : !hasAmount ? "Enter an amount." : null;
  const disabled = disabledReason !== null || busy || !preflight.ok;

  function closeReview() {
    setReviewOpen(false);
    ctaRef.current?.focus();
  }

  const amountB = parseToBaseUnits(amount || "0", DECIMALS_B);
  const rows = view
    ? [
        { label: "Amount", value: `${formatBaseUnits(amountB, DECIMALS_B, 6)} USDC` },
        { label: "Free USDC after", value: `${formatBaseUnits(view.freeUsdc - amountB, DECIMALS_B, 6)} USDC` },
        {
          label: "Required free USDC",
          value: `${formatBaseUnits(view.required, DECIMALS_B, 6)} USDC`,
          hint: view.openLongsCount > 0 ? `${view.openLongsCount} open long${view.openLongsCount === 1 ? "" : "s"}` : "No open longs",
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 md:p-6">
      <h2 className="text-h4 text-text-primary">Withdraw</h2>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="withdraw-usdc" className="text-body-sm block text-text-muted">
            USDC
          </label>
          {withdrawable !== null && (
            <button
              type="button"
              className="transition-brand focus-ring text-mono-sm tabular-nums rounded-sm border border-border px-2 py-1 text-text-muted hover:border-text-primary hover:text-text-primary"
              onClick={() => setAmount(formatBaseUnits(withdrawable, DECIMALS_B, 6))}
            >
              Max
            </button>
          )}
        </div>
        <NumberInput
          id="withdraw-usdc"
          placeholder="0.00 USDC"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {withdrawable !== null && (
          <p className="text-body-sm mt-2 text-text-muted">
            Withdrawable while your longs stay covered:{" "}
            <span className="text-mono-sm tabular-nums text-text-primary">
              {formatBaseUnits(withdrawable, DECIMALS_B, 6)} USDC
            </span>
          </p>
        )}
      </div>
      {preflight.reason === "insufficient" && <InsufficientBlock />}
      {preflight.reason === "solvency" && <SolvencyBlock />}
      <div className="flex flex-col gap-2">
        {disabledReason && (
          <p aria-live="polite" className="text-body-sm text-text-muted">
            {disabledReason}
          </p>
        )}
        <Button
          ref={ctaRef}
          variant="secondary"
          className="w-full"
          disabled={disabled}
          onClick={() => setReviewOpen(true)}
        >
          {busy ? "Confirm in your wallet" : "Withdraw"}
        </Button>
      </div>
      <VaultReviewSheet
        open={reviewOpen}
        title="Review withdrawal"
        rows={rows}
        confirmLabel="Confirm withdrawal"
        onCancel={closeReview}
        onConfirm={() => {
          closeReview();
          void handleWithdraw();
        }}
      />
    </div>
  );
}
