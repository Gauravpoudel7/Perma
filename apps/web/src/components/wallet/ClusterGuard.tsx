"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { CLUSTER } from "../../lib/constants";
import { useChainStore } from "../../store/useChainStore";

// Well-known genesis hashes. Wallet adapters don't expose "current network"
// directly to a dApp, so cluster mismatch is inferred from the CONFIGURED
// RPC endpoint's own genesis hash instead — the standard workaround.
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export function useClusterMismatch(): boolean {
  const { connection } = useConnection();
  const [mismatch, setMismatch] = useState(false);
  const setConnectionStatus = useChainStore((s) => s.setConnectionStatus);

  useEffect(() => {
    let cancelled = false;
    connection
      .getGenesisHash()
      .then((hash) => {
        if (cancelled) return;
        setConnectionStatus("ok");
        if (CLUSTER === "devnet") {
          setMismatch(hash !== DEVNET_GENESIS);
        } else {
          // localnet: any reachable genesis hash other than devnet's is fine —
          // a fresh local validator mints its own genesis hash every reset.
          setMismatch(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setConnectionStatus("unreachable");
        setMismatch(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, setConnectionStatus]);

  return mismatch;
}

/** Global-state banners: wrong cluster / RPC unreachable. COPY-DECK §4.4. */
export function ClusterGuard() {
  const mismatch = useClusterMismatch();
  const connectionStatus = useChainStore((s) => s.connectionStatus);

  if (connectionStatus === "unreachable") {
    return (
      <div role="alert" className="border-b border-border bg-surface px-4 py-2 text-center">
        <p className="text-body-sm text-danger">
          Can&rsquo;t reach the network. Displayed values may be stale.
        </p>
      </div>
    );
  }

  if (mismatch) {
    return (
      <div role="alert" className="border-b border-border bg-surface px-4 py-2 text-center">
        <p className="text-body-sm text-danger">
          PERMA runs on devnet. Switch your wallet&rsquo;s network to continue.
        </p>
      </div>
    );
  }

  return null;
}
