"use client";

import { useState } from "react";
import { Keypair, type Signer, type TransactionInstruction } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useSendPermaTx, fetchFreshOpenLongs } from "./useSendPermaTx";
import { usePermaProgram } from "./usePermaProgram";
import { useWalletGuard } from "./useWalletGuard";
import { useOpenLongs } from "./useOpenLongs";
import { useRequiredFreeUsdc } from "./useRequiredFreeUsdc";
import { useRangeStateValue } from "./useRangeState";
import { useTicketSize } from "./useTicketSize";
import { vaultShortfall } from "../lib/ticketSize";
import { useChainStore } from "../store/useChainStore";
import { useTradeFormStore, type Side } from "../store/useTradeFormStore";
import { buildMintPositionIx } from "../lib/perma";
import { resolveMintShortOrcaAccounts } from "../lib/resolvePosition";
import { marketAuthorityPda } from "../lib/pda";
import { buildMissingTickArrayIxs, type TickArrayStatus } from "../lib/tickArray";
import { slippageCappedTokenMax } from "../lib/liquidityMath";
import { canMintLong, estPremiumPerHour, requiredMargin } from "../lib/solvency";
import { sqrtPriceX64ToPrice, tickToPrice } from "../lib/whirlpool";
import { WHIRLPOOL, MAX_OPEN_LONGS } from "../lib/constants";
import { mintPostsFreshPyth, planMintPriceUpdate, readPriceAge, shouldRepost } from "../lib/pythUpdate";
import { openStepLabels, StalePriceError, type SequenceStep } from "../lib/txSequence";
import { PERMA_ERROR_COPY } from "../lib/errors";
import { MIN_RANGE_TICKS } from "../lib/tickMath";
import { useToastStore } from "../store/useToastStore";

// Demo pool: WSOL (9 decimals) / devUSDC (6 decimals).
const DECIMALS_A = 9;
const DECIMALS_B = 6;

/** Every figure the ReviewSheet shows. All are inputs to, or reads behind, the real transaction — nothing derived from a price model. */
export interface OpenPositionSummary {
  side: Side;
  tickLower: number;
  tickUpper: number;
  lowPrice: number;
  highPrice: number;
  liquidity: bigint;
  /** What `liquidity` uses at spot (base units, estimate). Short: locked from the vault. Long: the short liquidity it tracks. */
  amountA: bigint;
  amountB: bigint;
  /** `amountA` valued at spot plus `amountB`, in USDC. Display only. */
  usdEstimate: number | null;
  /** Short only: the slippage caps actually passed to `mint_position`. */
  tokenMaxA: bigint | null;
  tokenMaxB: bigint | null;
  /** Long only: `requiredMargin` for this leg and the wallet's free USDC it is checked against. */
  requiredMarginUsdc: bigint | null;
  freeUsdc: bigint | null;
  /** Long only: COPY-DECK "Est. premium per hour, at the current rate". */
  premiumPerHourUsdc: bigint | null;
  needsRent: boolean;
}

/**
 * The mint preflight + transaction build, shared by the CTA and the
 * ReviewSheet. `handleOpen` signs the whole flow (tick-array rent, Pyth
 * post, mint, Pyth rent reclaim) behind one wallet approval, so the posted
 * price is seconds old when the mint lands, not "however long the user took".
 */
export function useOpenPosition(tickArrayStatus: TickArrayStatus | null) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = usePermaProgram();
  const { sendSequence } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard();
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const userCollateral = useChainStore((s) => s.userCollateral);
  const spot = useChainStore((s) => s.spot);
  const openLongsDisplay = useOpenLongs();
  const requiredView = useRequiredFreeUsdc();
  const size = useTicketSize();

  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const setAmount = useTradeFormStore((s) => s.setAmount);
  const amountToken = useTradeFormStore((s) => s.amountToken);
  const rangeState = useRangeStateValue(tickLower, tickUpper);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const push = useToastStore((s) => s.push);

  const liquidity = size?.liquidity ?? null;
  const tickCurrent = spot?.tickCurrentIndex ?? null;
  const caps =
    side === "short" && liquidity && spot
      ? slippageCappedTokenMax(liquidity, spot.sqrtPriceX64, tickLower, tickUpper)
      : null;

  const available = rangeState
    ? BigInt(rangeState.totalShortLiquidity.toString()) - BigInt(rangeState.totalLongLiquidity.toString())
    : 0n;

  const marketRiskFields = market
    ? {
        longMarginHorizonSlots: BigInt(market.longMarginHorizonSlots.toString()),
        premiumRate: BigInt(market.premiumRate.toString()),
        premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
        longMarginBufferUsdc: BigInt(market.longMarginBufferUsdc.toString()),
      }
    : null;

  let disabledReason: string | null = null;
  /** True when the fix is a deposit, so the CTA can link to the Vault. */
  let needsDeposit = false;
  if (!canTransact) disabledReason = reason;
  else if (tickUpper - tickLower < MIN_RANGE_TICKS) disabledReason = PERMA_ERROR_COPY.RangeTooNarrow!;
  else if (!size) disabledReason = "Loading the pool price.";
  else if (size.error) disabledReason = size.error;
  else if (!liquidity || liquidity <= 0n) disabledReason = "Enter an amount.";
  else if (side === "short" && caps && userCollateral) {
    disabledReason = vaultShortfall(caps, {
      a: BigInt(userCollateral.balanceA.toString()),
      b: BigInt(userCollateral.balanceB.toString()),
    });
    needsDeposit = disabledReason !== null;
  } else if (side === "long" && available <= 0n) disabledReason = "No inventory in this range.";
  else if (side === "long" && liquidity > available) disabledReason = "Exceeds the short liquidity available in this range.";
  else if (side === "long" && openLongsDisplay.length >= MAX_OPEN_LONGS)
    disabledReason = "You've reached the maximum of 8 open longs.";
  else if (side === "long" && requiredView) {
    // `requiredView.required` is the same `requiredFreeUsdc(...)` figure the Vault gate uses.
    if (!canMintLong(requiredView.freeUsdc, requiredView.required, liquidity, requiredView.marketRiskFields, {
        tickLower,
        tickUpper,
      })) {
      disabledReason = "Your free USDC can't cover this long's required margin.";
      needsDeposit = true;
    }
  }

  async function buildSteps(
    price: Extract<Awaited<ReturnType<typeof planMintPriceUpdate>>, { ok: true }>,
    staleMessage: string
  ): Promise<SequenceStep<{ ixs: TransactionInstruction[]; signers: Signer[] }>[]> {
    if (!publicKey || !market || !marketPubkey || !liquidity || tickCurrent === null) return [];
    const [marketAuthority] = marketAuthorityPda(marketPubkey);
    const nonce = BigInt(Date.now());

    const tickArrayIxs =
      side === "short" && tickArrayStatus && (!tickArrayStatus.lowerExists || !tickArrayStatus.upperExists)
        ? buildMissingTickArrayIxs(WHIRLPOOL, publicKey, tickArrayStatus, tickLower, tickUpper, market.tickSpacing)
        : [];

    let mint: { ixs: TransactionInstruction[]; signers: Signer[] };
    if (side === "short") {
      const positionMint = Keypair.generate();
      const orcaAccounts = resolveMintShortOrcaAccounts(market, marketAuthority, tickLower, tickUpper, positionMint.publicKey);
      if (!spot) return [];
      const { tokenMaxA, tokenMaxB } = slippageCappedTokenMax(liquidity, spot.sqrtPriceX64, tickLower, tickUpper);
      const ix = await buildMintPositionIx(
        program,
        {
          leg: "short",
          owner: publicKey,
          market: marketPubkey,
          tickLower,
          tickUpper,
          liquidity,
          tokenMaxA,
          tokenMaxB,
          nonce,
          ...orcaAccounts,
          positionMint,
        },
        { priceUpdate: price.priceUpdate }
      );
      mint = { ixs: [ix], signers: [positionMint] };
    } else {
      const freshOpenLongs = await fetchFreshOpenLongs(program, connection, marketPubkey, publicKey);
      const ix = await buildMintPositionIx(
        program,
        {
          leg: "long",
          owner: publicKey,
          market: marketPubkey,
          tickLower,
          tickUpper,
          liquidity,
          nonce,
          whirlpool: WHIRLPOOL,
          existingOpenLongs: freshOpenLongs,
        },
        { priceUpdate: price.priceUpdate }
      );
      mint = { ixs: [ix], signers: [] };
    }

    const postTxs = price.post?.txs ?? [];
    const labels = openStepLabels({ rent: tickArrayIxs.length > 0, pythTxs: postTxs.length, side });
    const txs = [
      ...(tickArrayIxs.length > 0 ? [{ ixs: tickArrayIxs, signers: [] as Signer[] }] : []),
      ...postTxs,
      mint,
    ];
    const steps: SequenceStep<{ ixs: TransactionInstruction[]; signers: Signer[] }>[] = txs.map((tx, i) => ({
      label: labels[i]!,
      tx,
    }));
    // The posted price is re-read right before the mint goes out: a mint that
    // would land on a price the program calls stale is never sent.
    if (mintPostsFreshPyth()) {
      steps[steps.length - 1]!.check = async () => {
        const view = await readPriceAge(connection, price.priceUpdate);
        if (!view || shouldRepost(view.publishTime, Math.floor(Date.now() / 1000))) {
          throw new StalePriceError(staleMessage);
        }
      };
    }
    if (price.post) {
      steps.push({ label: labels[labels.length - 1]!, tx: { ixs: price.post.closeIxs, signers: [] }, always: true });
    }
    return steps;
  }

  async function handleOpen() {
    if (!publicKey || !market || !marketPubkey || !liquidity) return;
    setBusy(true);
    try {
      // One re-post: if the price went stale while the user was approving,
      // post a fresh one and ask once more. A second stale price stops here.
      for (let attempt = 0; attempt < 2; attempt++) {
        const price = await planMintPriceUpdate({ connection, payer: publicKey });
        if (!price.ok) {
          push({ variant: "error", message: price.error });
          return;
        }
        const staleMessage =
          attempt === 0
            ? "The price got too old while you were approving. Approve once more to post a fresh one."
            : PERMA_ERROR_COPY.OracleStale!;
        const steps = await buildSteps(price, staleMessage);
        if (steps.length === 0) return;
        const result = await sendSequence(steps, {
          successMessage: "Position opened.",
          failureMessage: "No position was opened.",
          onProgress: setProgress,
        });
        if (result.ok) {
          setAmount("", amountToken);
          return;
        }
        if (!(result.error instanceof StalePriceError)) return;
      }
    } catch (err) {
      console.error("[useOpenPosition]", err);
      push({
        variant: "error",
        message: err instanceof Error ? err.message : "The mint was not sent.",
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // Review figures: computed with the exact same inputs `handleOpen` will use.
  let summary: OpenPositionSummary | null = null;
  if (liquidity && liquidity > 0n && size && spot) {
    const price = sqrtPriceX64ToPrice(spot.sqrtPriceX64, DECIMALS_A, DECIMALS_B);
    summary = {
      side,
      tickLower,
      tickUpper,
      lowPrice: tickToPrice(tickLower, DECIMALS_A, DECIMALS_B),
      highPrice: tickToPrice(tickUpper, DECIMALS_A, DECIMALS_B),
      liquidity,
      amountA: size.amountA,
      amountB: size.amountB,
      usdEstimate: (Number(size.amountA) / 1e9) * price + Number(size.amountB) / 1e6,
      tokenMaxA: caps?.tokenMaxA ?? null,
      tokenMaxB: caps?.tokenMaxB ?? null,
      requiredMarginUsdc: side === "long" && marketRiskFields ? requiredMargin(marketRiskFields, liquidity, { tickLower, tickUpper }) : null,
      freeUsdc: side === "long" && userCollateral ? BigInt(userCollateral.balanceB.toString()) : null,
      premiumPerHourUsdc: side === "long" && marketRiskFields ? estPremiumPerHour(marketRiskFields, liquidity, { tickLower, tickUpper }) : null,
      needsRent: !!tickArrayStatus && (!tickArrayStatus.lowerExists || !tickArrayStatus.upperExists),
    };
  }

  return { side, disabledReason, needsDeposit, busy, progress, summary, handleOpen };
}

