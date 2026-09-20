"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { NumberInput } from "../primitives/NumberInput";
import { Button } from "../primitives/Button";
import { useSendPermaTx } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { buildDepositCollateralIx } from "../../lib/perma";
import { parseToBaseUnits } from "../../lib/format";

const DECIMALS_B = 6;

/** COPY-DECK §4.3: Header "Collateral", CTA "Deposit". USDC only (Fair MVP). */
export function DepositForm() {
  const { publicKey } = useWallet();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard({ allowWhilePaused: true });
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleDeposit() {
    if (!publicKey || !market || !marketPubkey) return;
    setBusy(true);
    try {
      const amountB = parseToBaseUnits(amount, DECIMALS_B);
      const userTokenA = getAssociatedTokenAddressSync(market.tokenMintA, publicKey);
      const userTokenB = getAssociatedTokenAddressSync(market.tokenMintB, publicKey);

      // Idempotent create: a no-op if the ATA already exists, so a first-time
      // wallet can still deposit without a separate manual setup step.
      const ataIxs = [
        createAssociatedTokenAccountIdempotentInstruction(publicKey, userTokenA, publicKey, market.tokenMintA),
        createAssociatedTokenAccountIdempotentInstruction(publicKey, userTokenB, publicKey, market.tokenMintB),
      ];

      const depositIx = await buildDepositCollateralIx(program, {
        owner: publicKey,
        market: marketPubkey,
        userTokenA,
        userTokenB,
        vaultA: market.vaultA,
        vaultB: market.vaultB,
        amountA: 0n,
        amountB: amountB,
      });

      await send([...ataIxs, depositIx], { successMessage: "Deposit confirmed." });
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <h3 className="text-h4 mb-4 text-text-primary">Deposit</h3>
      <NumberInput
        placeholder="0.00 USDC"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button
        className="mt-4 w-full"
        disabled={!canTransact || busy || !amount}
        onClick={handleDeposit}
        title={canTransact ? undefined : reason ?? undefined}
      >
        {busy ? "Confirm in your wallet" : "Deposit"}
      </Button>
      <p className="mt-3 text-body-sm text-text-muted">
        SOL and USDC only. This market accepts no other collateral.
      </p>
    </div>
  );
}
