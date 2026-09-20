"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CollateralSummary } from "../../components/vault/CollateralSummary";
import { DepositForm } from "../../components/vault/DepositForm";
import { WithdrawForm } from "../../components/vault/WithdrawForm";

export default function VaultPage() {
  const { connected } = useWallet();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-h2 mb-6 text-text-primary">Collateral</h1>
      {!connected ? (
        <p className="text-body-md text-text-muted">Connect a wallet to continue.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <CollateralSummary />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <DepositForm />
            <WithdrawForm />
          </div>
        </div>
      )}
    </div>
  );
}
