"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useChainStore } from "../../store/useChainStore";
import { useLocalnetFunding } from "../../hooks/useLocalnetFunding";

/**
 * Peer pattern (Hyperliquid / Panoptic): after connect, point a wallet with
 * nothing deposited at the deposit flow. Inline and non-blocking — no modal,
 * no toast, no dismiss state. It disappears on its own once `refetchAll`
 * lands a non-zero UserCollateral. The mint button's own guards are untouched.
 */
export function CollateralNudge() {
  const { connected } = useWallet();
  const loaded = useChainStore((s) => s.collateralLoaded);
  const uc = useChainStore((s) => s.userCollateral);
  const { status: fundingStatus } = useLocalnetFunding();

  if (!connected || !loaded) return null;

  const total = uc
    ? BigInt(uc.balanceA.toString()) +
      BigInt(uc.balanceB.toString()) +
      BigInt(uc.lockedA.toString()) +
      BigInt(uc.lockedB.toString())
    : 0n;
  if (total > 0n) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg p-4"
    >
      <p className="text-body-sm text-text-muted">
        No collateral deposited. Deposit SOL or USDC in Vault to open a position.
      </p>
      {fundingStatus === "mismatch" && (
        <p className="text-body-sm text-text-muted">
          On localnet, only the fixture-funded wallet holds USDC. Vault explains how to connect it.
        </p>
      )}
      <Link
        href="/vault"
        className="transition-brand focus-ring text-button inline-flex shrink-0 items-center justify-center rounded-md border border-text-primary px-4 py-3 text-text-primary hover:bg-text-primary hover:text-bg"
      >
        Go to Vault
      </Link>
    </div>
  );
}
