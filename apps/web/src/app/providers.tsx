"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { RPC_URL } from "../lib/constants";
import { ToastContainer } from "../components/primitives/ToastContainer";

/**
 * No explicit wallet adapters registered. Phantom, Solflare, Backpack,
 * Coinbase Wallet, etc. are all Wallet Standard-compliant and are
 * auto-detected by `useWallet()` without registration — the modern,
 * recommended pattern. Explicitly importing from `@solana/wallet-adapter-
 * wallets`'s barrel was tried and rejected: that package's WalletConnect
 * adapter transitively pulls in an entire unrelated Ethereum stack
 * (`@reown/appkit`, `viem`, `ox`, `pino`), nearly tripling this app's
 * bundle size for wallets Wallet Standard already finds for free.
 *
 * Deliberately NOT `@solana/wallet-adapter-react-ui` either — its default
 * modal has its own baked-in styling that would fail UI-QA's "default
 * template" rejection gate. `WalletListModal.tsx` is a from-scratch
 * replacement driven by the same `useWallet()` hook this provider exposes.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
        <ToastContainer />
      </WalletProvider>
    </ConnectionProvider>
  );
}
