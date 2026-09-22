"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { SlideOver } from "../primitives/SlideOver";
import { InlineError } from "../primitives/States";
import type { LocalnetKeypairSigner } from "./LocalnetKeypairWallet";
import { LOCALNET_FUNDED_WALLET } from "../../lib/localnetFunding";
import { truncateAddress } from "../../lib/format";

/**
 * From-scratch wallet picker — no `@solana/wallet-adapter-react-ui` import,
 * no external CSS. Rendered on the one PERMA panel primitive (APP-SHELL: "No
 * Pop-ups... use slide-over panels"), which gives it Esc, a focus trap and
 * an initial focus for free; `ConnectButton` returns focus when it closes.
 *
 * On localnet the list also carries the CLI-keypair adapter, which needs a
 * keypair file before it can be selected. The file is read in the browser
 * with `FileReader` and never leaves it.
 */
/**
 * Duck-typed, not an `instanceof`: the adapter module is only ever loaded on
 * a localnet build, so this file must not import it as a value or its code
 * would ship everywhere.
 */
function asLocalnetAdapter(adapter: unknown): LocalnetKeypairSigner | null {
  return typeof (adapter as { loadSecretKey?: unknown })?.loadSecretKey === "function"
    ? (adapter as LocalnetKeypairSigner)
    : null;
}

export function WalletListModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select } = useWallet();
  const [keyError, setKeyError] = useState<string | null>(null);

  async function loadKeypairFile(adapter: LocalnetKeypairSigner, file: File) {
    setKeyError(null);
    let loaded: string;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("not an array");
      loaded = adapter.loadSecretKey(Uint8Array.from(parsed)).toBase58();
    } catch {
      setKeyError("That file isn't a Solana CLI keypair. Pick the id.json written by solana-keygen.");
      return;
    }
    if (LOCALNET_FUNDED_WALLET && loaded !== LOCALNET_FUNDED_WALLET) {
      await adapter.disconnect();
      setKeyError(
        `This keypair is ${truncateAddress(loaded, 6)}, not the fixture-funded wallet ${truncateAddress(
          LOCALNET_FUNDED_WALLET,
          6
        )}. Use that key, or re-run make-fixtures with this one and restart the validator.`
      );
      return;
    }
    select(adapter.name);
    onClose();
  }

  return (
    <SlideOver open={open} title="Connect a wallet" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {wallets.length === 0 && (
          <p className="text-body-sm text-text-muted">No Solana wallets detected in this browser.</p>
        )}
        {wallets.map((w) => {
          const localnet = asLocalnetAdapter(w.adapter);
          return localnet ? (
            <div key={w.adapter.name} className="rounded-md border border-border p-4">
              <p className="text-body-md text-text-primary">{w.adapter.name}</p>
              <p className="text-body-sm mt-1 text-text-muted">
                Signs with a Solana CLI keypair you load below. The file is read in this browser and kept
                in memory only. Local testing only. Never use a mainnet key here.
              </p>
              <label
                htmlFor="localnet-keypair"
                className="text-caption mt-3 block text-text-muted"
              >
                Load CLI keypair JSON
              </label>
              <input
                id="localnet-keypair"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadKeypairFile(localnet, file);
                }}
                className="focus-ring text-body-sm mt-1 w-full rounded-md border border-border bg-bg px-3 py-3 text-text-muted file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-text-primary"
              />
            </div>
          ) : (
            <button
              key={w.adapter.name}
              type="button"
              onClick={() => {
                select(w.adapter.name as WalletName);
                onClose();
              }}
              className="transition-brand focus-ring flex min-h-[44px] items-center justify-between rounded-md border border-border px-4 py-3 text-body-md text-text-primary hover:bg-bg"
            >
              <span>{w.adapter.name}</span>
              <span className="text-caption text-text-muted">{w.readyState}</span>
            </button>
          );
        })}
        {keyError && <InlineError>{keyError}</InlineError>}
      </div>
    </SlideOver>
  );
}
