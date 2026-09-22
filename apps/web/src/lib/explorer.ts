import { EXPLORER_BASE, CLUSTER } from "./constants";

/**
 * Explorer link for a transaction signature. Localnet has no public explorer
 * cluster param that resolves without a custom RPC query string; devnet is
 * the simple case. On localnet this still produces a usable link if the user
 * points explorer.solana.com at a custom RPC manually — we don't hide the
 * link, we just can't guarantee it resolves without that manual step.
 */
export function explorerTxUrl(signature: string): string {
  return explorerUrl("tx", signature);
}

/** Explorer link for an account (a position PDA, for instance). Same cluster caveat as above. */
export function explorerAddressUrl(address: string): string {
  return explorerUrl("address", address);
}

function explorerUrl(kind: "tx" | "address", id: string): string {
  if (CLUSTER === "devnet") {
    return `${EXPLORER_BASE}/${kind}/${id}?cluster=devnet`;
  }
  return `${EXPLORER_BASE}/${kind}/${id}?cluster=custom&customUrl=${encodeURIComponent(
    process.env.NEXT_PUBLIC_RPC_URL ?? ""
  )}`;
}
