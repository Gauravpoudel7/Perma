"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";

/**
 * From-scratch wallet picker — no `@solana/wallet-adapter-react-ui` import,
 * no external CSS. A native `<dialog>`-style overlay per APP-SHELL's "No
 * Pop-ups... use slide-over panels or inline expansion" constraint, styled
 * entirely with brand tokens.
 */
export function WalletListModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { wallets, select } = useWallet();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-lg border border-border bg-surface p-6"
      >
        <h2 className="text-h4 text-text-primary">Connect a wallet</h2>
        <div className="mt-4 flex flex-col gap-2">
          {wallets.length === 0 && (
            <p className="text-body-sm text-text-muted">
              No Solana wallets detected in this browser.
            </p>
          )}
          {wallets.map((w) => (
            <button
              key={w.adapter.name}
              onClick={() => {
                select(w.adapter.name as WalletName);
                onClose();
              }}
              className="transition-brand focus-ring flex items-center justify-between rounded-md border border-border px-4 py-3 text-body-md text-text-primary hover:bg-bg"
            >
              <span>{w.adapter.name}</span>
              <span className="text-caption text-text-muted">{w.readyState}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
