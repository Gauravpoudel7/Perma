"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "../primitives/Button";
import { truncateAddress } from "../../lib/format";
import { WalletListModal } from "./WalletListModal";

export function ConnectButton() {
  const { connected, publicKey, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    ctaRef.current?.focus();
  }, []);

  if (connected && publicKey) {
    return (
      <Button variant="secondary" onClick={() => disconnect()} className="text-mono-sm">
        {truncateAddress(publicKey.toBase58())}
      </Button>
    );
  }

  return (
    <>
      <Button ref={ctaRef} variant="secondary" onClick={() => setOpen(true)}>
        Connect
      </Button>
      <WalletListModal open={open} onClose={close} />
    </>
  );
}
