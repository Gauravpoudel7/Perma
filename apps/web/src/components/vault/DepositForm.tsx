"use client";

import { useState } from "react";
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
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const [amountSol, setAmountSol] = useState("");
  const [amountUsdc, setAmountUsdc] = useState("");
  const [busy, setBusy] = useState(false);

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

      await send(ixs, { successMessage: "Deposit confirmed." });
      setAmountSol("");
      setAmountUsdc("");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    canTransact && !busy && ((amountSol && Number(amountSol) > 0) || (amountUsdc && Number(amountUsdc) > 0));

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h3 className="text-h4 mb-4 text-text-primary">Deposit</h3>
      <label className="text-body-sm mb-2 block text-text-muted">SOL (wrapped on deposit)</label>
      <NumberInput
        placeholder="0.00 SOL"
        value={amountSol}
        onChange={(e) => setAmountSol(e.target.value)}
      />
      <label className="text-body-sm mb-2 mt-4 block text-text-muted">USDC</label>
      <NumberInput
        placeholder="0.00 USDC"
        value={amountUsdc}
        onChange={(e) => setAmountUsdc(e.target.value)}
      />
      <Button
        className="mt-4 w-full"
        disabled={!canSubmit}
        onClick={handleDeposit}
        title={canTransact ? undefined : reason ?? undefined}
      >
        {busy ? "Confirm in your wallet" : "Deposit"}
      </Button>
      <p className="mt-3 text-body-sm text-text-muted">
        Shorts need SOL and USDC in the vault. Leave a little SOL in Phantom for fees.
      </p>
    </div>
  );
}
