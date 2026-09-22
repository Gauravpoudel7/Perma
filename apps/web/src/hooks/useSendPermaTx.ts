"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction, type TransactionInstruction, type Signer } from "@solana/web3.js";
import { usePermaProgram } from "./usePermaProgram";
import {
  fetchAllPositionsForOwner,
  fetchMarket,
  fetchOpenLongsForOwner,
  fetchPremiumIndex,
  fetchRangeState,
} from "../lib/accounts";
import { parseAnchorError } from "../lib/errors";
import { premiumIndexPda, rangeStatePda } from "../lib/pda";
import { describeEvents, fetchTxEvents, slicesTouchedBy, type PermaEvent } from "../lib/events";
import { useChainStore } from "../store/useChainStore";
import { useToastStore } from "../store/useToastStore";

/**
 * The single choke point for every write transaction in this app.
 *
 * 1. toast: "Confirm in your wallet" (COPY-DECK's Submitting copy).
 * 2. sign + send via the wallet adapter, confirm at "confirmed".
 * 3. on success: replace the toast with the caller's success copy (+ the
 *    "View transaction" link), then immediately re-fetch every chain-derived
 *    account this app cares about — not waiting for the next poll tick — so
 *    Portfolio/Vault reflect the new state right away. Component 11 adds a
 *    best-effort decode of the confirmed tx's events (`lib/events.ts`): they
 *    pick which *extra* slices (market, premium index, the touched range) to
 *    refetch on top of the unconditional collateral + positions refetch, and
 *    they name what happened on the toast. If decoding yields nothing, the
 *    behavior is exactly the pre-11 one; polling is never replaced.
 * 4. on failure: map the error via `lib/errors.ts` and show
 *    "Transaction failed: {program error}. Nothing was changed." with a
 *    "View transaction" link only if a signature actually exists (a
 *    simulation failure before submission has none).
 */
export function useSendPermaTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const program = usePermaProgram();
  const push = useToastStore((s) => s.push);
  const update = useToastStore((s) => s.update);

  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const setUserCollateral = useChainStore((s) => s.setUserCollateral);
  const setPositions = useChainStore((s) => s.setPositions);
  const setMarket = useChainStore((s) => s.setMarket);
  const setPremiumIndex = useChainStore((s) => s.setPremiumIndex);
  const setRangeState = useChainStore((s) => s.setRangeState);
  const touchRefreshedAt = useChainStore((s) => s.touchRefreshedAt);

  const refetchAll = useCallback(async () => {
    if (!publicKey || !marketPubkey) return;
    const { fetchUserCollateral } = await import("../lib/accounts");
    const { userCollateralPda } = await import("../lib/pda");
    const [ucPda] = userCollateralPda(marketPubkey, publicKey);
    const [uc, positions] = await Promise.all([
      fetchUserCollateral(program, ucPda),
      fetchAllPositionsForOwner(program, connection, marketPubkey, publicKey),
    ]);
    setUserCollateral(uc);
    setPositions(positions);
    touchRefreshedAt();
  }, [publicKey, marketPubkey, program, connection, setUserCollateral, setPositions, touchRefreshedAt]);

  /** Event-directed extras: only the slices the confirmed tx actually touched. */
  const refetchTouched = useCallback(
    async (events: PermaEvent[]) => {
      if (!marketPubkey || events.length === 0) return;
      const touched = slicesTouchedBy(events);
      const ranges = touched.allKnownRanges
        ? Object.keys(useChainStore.getState().rangeStates).map((k) => k.split(":").map(Number) as [number, number])
        : touched.ranges;
      await Promise.all([
        touched.market ? fetchMarket(program, marketPubkey).then(setMarket) : null,
        touched.premiumIndex
          ? fetchPremiumIndex(program, premiumIndexPda(marketPubkey)[0]).then(setPremiumIndex)
          : null,
        ...ranges.map(([lo, hi]) =>
          fetchRangeState(program, rangeStatePda(marketPubkey, lo, hi)[0]).then((s) => {
            if (s) setRangeState({ tickLower: lo, tickUpper: hi }, s);
          })
        ),
      ]);
    },
    [marketPubkey, program, setMarket, setPremiumIndex, setRangeState]
  );

  const send = useCallback(
    async (
      ixs: TransactionInstruction[],
      opts: { successMessage: string; extraSigners?: Signer[] }
    ): Promise<string | null> => {
      if (!publicKey) throw new Error("Connect a wallet to continue.");

      const toastId = push({ variant: "pending", message: "Confirm in your wallet" });

      try {
        const tx = new Transaction().add(...ixs);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        if (opts.extraSigners?.length) tx.partialSign(...opts.extraSigners);

        const signature = await sendTransaction(tx, connection, {
          signers: opts.extraSigners,
        });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

        update(toastId, { variant: "success", message: opts.successMessage, signature });
        // Best-effort: `[]` on any failure, and then this is exactly the pre-11 path.
        const events = await fetchTxEvents(connection, program, signature);
        if (events.length > 0) update(toastId, { detail: describeEvents(events) });
        await Promise.all([refetchAll(), refetchTouched(events)]);
        return signature;
      } catch (e) {
        // Toast is the user-facing result. Do not rethrow — callers often
        // await without catch, and Next.js turns the rejection into a full-screen
        // "Unhandled Runtime Error" overlay (WalletSendTransactionError).
        console.error("[useSendPermaTx]", e);
        const { message } = parseAnchorError(e);
        const signature = (e as { signature?: string })?.signature;
        update(toastId, {
          variant: "error",
          message: `Transaction failed: ${message}. Nothing was changed.`,
          signature,
        });
        return null;
      }
    },
    [publicKey, connection, program, sendTransaction, push, update, refetchAll, refetchTouched]
  );

  return { send, refetchAll };
}

/** Fresh (never store-cached) open-longs fetch — the only safe source for `remainingAccounts`. */
export async function fetchFreshOpenLongs(
  program: Parameters<typeof fetchOpenLongsForOwner>[0],
  connection: Parameters<typeof fetchOpenLongsForOwner>[1],
  market: Parameters<typeof fetchOpenLongsForOwner>[2],
  owner: Parameters<typeof fetchOpenLongsForOwner>[3]
) {
  return fetchOpenLongsForOwner(program, connection, market, owner);
}
