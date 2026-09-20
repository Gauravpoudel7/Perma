"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Perma } from "../idl/perma";
import { getPermaProgram, type PermaWallet } from "../lib/perma";

/**
 * A wallet that can never sign — used only so `Program`/`AnchorProvider`
 * can be constructed for READ-ONLY fetches (`.account.X.fetch`) before a
 * real wallet connects. Any attempt to actually sign with this throws
 * loudly rather than silently producing an invalid transaction.
 */
const READ_ONLY_WALLET: PermaWallet = {
  publicKey: PublicKey.default,
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error("Connect a wallet to continue.");
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error("Connect a wallet to continue.");
  },
};

/**
 * `Program<Perma>` bound to the connected wallet when one exists, or a
 * read-only stand-in otherwise. Market/Portfolio/Vault reads work either
 * way; `useSendPermaTx` separately checks `wallet.connected` before letting
 * anyone submit a transaction, so the read-only fallback here can never be
 * used to sign anything.
 */
export function usePermaProgram(): Program<Perma> {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
      const anchorWallet: PermaWallet = {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      };
      return getPermaProgram(connection, anchorWallet);
    }
    return getPermaProgram(connection, READ_ONLY_WALLET);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);
}
