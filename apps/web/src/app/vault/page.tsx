"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { CollateralSummary } from "../../components/vault/CollateralSummary";
import { DepositForm } from "../../components/vault/DepositForm";
import { WithdrawForm } from "../../components/vault/WithdrawForm";
import { DegradedState, EmptyState, InlineError } from "../../components/primitives/States";
import { useLocalnetFunding } from "../../hooks/useLocalnetFunding";
import { truncateAddress } from "../../lib/format";

/** The collateral desk: what can leave, what must stay, then the two ways to move it. */
export default function VaultPage() {
  const { connected } = useWallet();
  const { status, fundedWallet } = useLocalnetFunding();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h3 text-text-primary">Collateral</h1>
      {!connected ? (
        <EmptyState>Connect a wallet to continue.</EmptyState>
      ) : (
        <>
          {status === "mismatch" && fundedWallet && (
            <InlineError>
              This address isn&rsquo;t the wallet the localnet fixtures funded (
              {truncateAddress(fundedWallet, 6)}). Orca devUSDC can&rsquo;t be minted on a local
              validator, so a USDC deposit from here will fail. Connect with the Localnet CLI keypair, or
              re-run make-fixtures for this address and restart the validator.
            </InlineError>
          )}
          {status === "unconfigured" && (
            <DegradedState>
              Run yarn sync-fixture-wallet to check this wallet against the one the localnet fixtures
              funded.
            </DegradedState>
          )}
          <CollateralSummary />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <DepositForm />
            <WithdrawForm />
          </div>
        </>
      )}
    </div>
  );
}
