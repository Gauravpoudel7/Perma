"use client";

import { useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { NumberInput } from "../primitives/NumberInput";
import { Button } from "../primitives/Button";
import { VaultReviewSheet } from "./VaultReviewSheet";
import { useLocalnetFunding } from "../../hooks/useLocalnetFunding";
import { useSendPermaTx } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { buildDepositCollateralIx } from "../../lib/perma";
import { parseToBaseUnits } from "../../lib/format";

const DECIMALS_A = 9;
const DECIMALS_B = 6;

/**
 * Deposit WSOL and/or USDC into PERMA collateral.
 * Shorts need both sides; the earlier USDC-only form left free WSOL at 0 and
 * made Open Short fail with a vague "Unexpected error".
 */
export function DepositForm() {
  const { publicKey } = useWallet();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard();
  const { status: fundingStatus } = useLocalnetFunding();
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const [amountSol, setAmountSol] = useState("");
  const [amountUsdc, setAmountUsdc] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  async function handleDeposit() {
    if (!publicKey || !market || !marketPubkey) return;
    const amountA = amountSol ? parseToBaseUnits(amountSol, DECIMALS_A) : 0n;
    const amountB = amountUsdc ? parseToBaseUnits(amountUsdc, DECIMALS_B) : 0n;
    if (amountA <= 0n && amountB <= 0n) return;

    setBusy(true);
    try {
      const userTokenA = getAssociatedTokenAddressSync(market.tokenMintA, publicKey);
      const userTokenB = getAssociatedTokenAddressSync(market.tokenMintB, publicKey);

      const ixs: TransactionInstruction[] = [
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          userTokenA,
          publicKey,
          market.tokenMintA
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          userTokenB,
          publicKey,
          market.tokenMintB
        ),
      ];

      // Wrap native SOL into the WSOL ATA before depositing side A.
      if (amountA > 0n) {
        if (!market.tokenMintA.equals(NATIVE_MINT)) {
          throw new Error("This market's side A is not WSOL; cannot wrap SOL.");
        }
        ixs.push(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: userTokenA,
            lamports: amountA,
          }),
          createSyncNativeInstruction(userTokenA, TOKEN_PROGRAM_ID)
        );
      }

      ixs.push(
        await buildDepositCollateralIx(program, {
          owner: publicKey,
          market: marketPubkey,
          userTokenA,
          userTokenB,
          vaultA: market.vaultA,
          vaultB: market.vaultB,
          amountA,
          amountB,
        })
      );

      const sig = await send(ixs, { successMessage: "Deposit confirmed." });
      if (sig) {
        setAmountSol("");
        setAmountUsdc("");
      }
    } finally {
      setBusy(false);
    }
  }

  const hasAmount = (amountSol && Number(amountSol) > 0) || (amountUsdc && Number(amountUsdc) > 0);
  // devUSDC can't be minted locally, so only the fixture-funded wallet has any.
  // A SOL-only deposit still works from ordinary lamports, so only USDC is blocked.
  const usdcBlocked = fundingStatus === "mismatch" && !!amountUsdc && Number(amountUsdc) > 0;
  const disabledReason = !canTransact
    ? reason
    : !hasAmount
    ? "Enter an amount."
    : usdcBlocked
    ? "This wallet holds no localnet USDC. Deposit SOL only, or connect the fixture-funded wallet."
    : null;

  function closeReview() {
    setReviewOpen(false);
    ctaRef.current?.focus();
  }

  const rows = [
    { label: "SOL (wrapped on deposit)", value: `${amountSol && Number(amountSol) > 0 ? amountSol : "0"} SOL` },
    { label: "USDC", value: `${amountUsdc && Number(amountUsdc) > 0 ? amountUsdc : "0"} USDC` },
  ];

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 md:p-6">
      <h2 className="text-h4 text-text-primary">Deposit</h2>
      <div>
        <label htmlFor="deposit-sol" className="text-body-sm mb-2 block text-text-muted">
          SOL (wrapped on deposit)
        </label>
        <NumberInput
          id="deposit-sol"
          placeholder="0.00 SOL"
          value={amountSol}
          onChange={(e) => setAmountSol(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="deposit-usdc" className="text-body-sm mb-2 block text-text-muted">
          USDC
        </label>
        <NumberInput
          id="deposit-usdc"
          placeholder="0.00 USDC"
          value={amountUsdc}
          onChange={(e) => setAmountUsdc(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        {disabledReason && (
          <p aria-live="polite" className="text-body-sm text-text-muted">
            {disabledReason}
          </p>
        )}
        <Button
          ref={ctaRef}
          className="w-full"
          disabled={disabledReason !== null || busy}
          onClick={() => setReviewOpen(true)}
        >
          {busy ? "Confirm in your wallet" : "Deposit"}
        </Button>
      </div>
      <p className="text-body-sm text-text-muted">
        SOL and USDC only. This market accepts no other collateral. Shorts need both in the vault; leave a
        little SOL in your wallet for fees.
      </p>
      <VaultReviewSheet
        open={reviewOpen}
        title="Review deposit"
        rows={rows}
        confirmLabel="Confirm deposit"
        onCancel={closeReview}
        onConfirm={() => {
          closeReview();
          void handleDeposit();
        }}
      />
    </div>
  );
}
