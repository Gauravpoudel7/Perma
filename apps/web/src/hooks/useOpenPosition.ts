"use client";

import { useState } from "react";
import { Keypair, type TransactionInstruction } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useSendPermaTx, fetchFreshOpenLongs } from "./useSendPermaTx";
import { usePermaProgram } from "./usePermaProgram";
import { useWalletGuard } from "./useWalletGuard";
import { useOpenLongs } from "./useOpenLongs";
import { useRequiredFreeUsdc } from "./useRequiredFreeUsdc";
import { useRangeStateValue } from "./useRangeState";
import { useChainStore } from "../store/useChainStore";
import { useTradeFormStore, type Side } from "../store/useTradeFormStore";
import { buildMintPositionIx } from "../lib/perma";
import { resolveMintShortOrcaAccounts } from "../lib/resolvePosition";
import { marketAuthorityPda } from "../lib/pda";
import { buildMissingTickArrayIxs, type TickArrayStatus } from "../lib/tickArray";
import { slippageCappedTokenMax } from "../lib/liquidityMath";
import { canMintLong, estPremiumPerHour, requiredMargin } from "../lib/solvency";
import { tickToPrice } from "../lib/whirlpool";
import { WHIRLPOOL, MAX_OPEN_LONGS } from "../lib/constants";
import { resolveMintPriceUpdate } from "../lib/pythUpdate";
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
 * The mint preflight + transaction build, lifted out of `OpenPositionButton`
 * so the CTA and the ReviewSheet share one guard chain and one `handleOpen`.
 * The guard order and the two instruction builders are unchanged from the
 * pre-U1 button; only the JSX moved.
 */
export function useOpenPosition(tickArrayStatus: TickArrayStatus | null) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard();
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const userCollateral = useChainStore((s) => s.userCollateral);
  const spot = useChainStore((s) => s.spot);
  const openLongsDisplay = useOpenLongs();
  const requiredView = useRequiredFreeUsdc();

  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const sizeInput = useTradeFormStore((s) => s.sizeInput);
  const setSizeInput = useTradeFormStore((s) => s.setSizeInput);
  const rangeState = useRangeStateValue(tickLower, tickUpper);
  const [busy, setBusy] = useState(false);
  const push = useToastStore((s) => s.push);

  let liquidity: bigint | null = null;
  try {
    liquidity = sizeInput ? BigInt(sizeInput) : null;
  } catch {
    liquidity = null;
  }

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
  if (!canTransact) disabledReason = reason;
  else if (!liquidity || liquidity <= 0n) disabledReason = "Enter a position size.";
  else if (side === "long" && available <= 0n) disabledReason = "No inventory in this range.";
  else if (side === "long" && liquidity > available) disabledReason = "Exceeds available inventory.";
  else if (side === "long" && openLongsDisplay.length >= MAX_OPEN_LONGS)
    disabledReason = "You've reached the maximum of 8 open longs.";
  else if (side === "long" && requiredView) {
    // `requiredView.required` is the same `requiredFreeUsdc(...)` figure the Vault gate uses.
    if (!canMintLong(requiredView.freeUsdc, requiredView.required, liquidity, requiredView.marketRiskFields)) {
      disabledReason = "Your free USDC can't cover this long's required margin.";
    }
  }

  async function handleOpen() {
    if (!publicKey || !market || !marketPubkey || !liquidity) return;
    setBusy(true);
    let closeIxs: TransactionInstruction[] = [];
    let opened = false;
    try {
      const price = await resolveMintPriceUpdate({
        connection,
        payer: publicKey,
        sendTx: (ixs, signers, successMessage) => send(ixs, { successMessage, extraSigners: signers }),
      });
      closeIxs = price.closeIxs;
      if (!price.ok || !price.priceUpdate) {
        if (!price.alreadyToasted && price.error) {
          push({ variant: "error", message: price.error });
        }
        return;
      }

      const [marketAuthority] = marketAuthorityPda(marketPubkey);
      const nonce = BigInt(Date.now());

      if (side === "short") {
        const positionMint = Keypair.generate();
        const orcaAccounts = resolveMintShortOrcaAccounts(
          market,
          marketAuthority,
          tickLower,
          tickUpper,
          positionMint.publicKey
        );
        const { tokenMaxA, tokenMaxB } = slippageCappedTokenMax(
          liquidity,
          spot?.tickCurrentIndex ?? tickLower,
          tickLower,
          tickUpper
        );

        const tickArrayIxs =
          tickArrayStatus && (!tickArrayStatus.lowerExists || !tickArrayStatus.upperExists)
            ? buildMissingTickArrayIxs(
                WHIRLPOOL,
                publicKey,
                tickArrayStatus,
                tickLower,
                tickUpper,
                market.tickSpacing
              )
            : [];
        // A P3 short mint has 43 bytes of headroom. The tick-array rent, when
        // it is due, goes in the transaction before the mint.
        if (tickArrayIxs.length > 0) {
          const rentSig = await send(tickArrayIxs, { successMessage: "Tick array created." });
          if (!rentSig) return;
        }

        const mintIx = await buildMintPositionIx(program, {
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
        }, { priceUpdate: price.priceUpdate });

        const shortSig = await send([mintIx], {
          successMessage: "Position opened.",
          extraSigners: [positionMint],
        });
        if (shortSig) {
          opened = true;
          setSizeInput("");
        }
      } else {
        const freshOpenLongs = await fetchFreshOpenLongs(program, connection, marketPubkey, publicKey);
        const mintIx = await buildMintPositionIx(program, {
          leg: "long",
          owner: publicKey,
          market: marketPubkey,
          tickLower,
          tickUpper,
          liquidity,
          nonce,
          whirlpool: WHIRLPOOL,
          existingOpenLongs: freshOpenLongs,
        }, { priceUpdate: price.priceUpdate });
        const longSig = await send([mintIx], { successMessage: "Position opened." });
        if (longSig) {
          opened = true;
          setSizeInput("");
        }
      }
    } catch (err) {
      console.error("[useOpenPosition]", err);
      push({
        variant: "error",
        message: err instanceof Error ? err.message : "The mint was not sent.",
      });
    } finally {
      if (closeIxs.length > 0) {
        await send(closeIxs, {
          successMessage: "Pyth update account closed.",
          failureSuffix: opened
            ? "The position is open. Pyth rent was not reclaimed."
            : "Pyth rent was not reclaimed.",
        });
      }
      setBusy(false);
    }
  }

  // Review figures: computed with the exact same inputs `handleOpen` will use.
  let summary: OpenPositionSummary | null = null;
  if (liquidity && liquidity > 0n) {
    const caps =
      side === "short"
        ? slippageCappedTokenMax(liquidity, spot?.tickCurrentIndex ?? tickLower, tickLower, tickUpper)
        : null;
    summary = {
      side,
      tickLower,
      tickUpper,
      lowPrice: tickToPrice(tickLower, DECIMALS_A, DECIMALS_B),
      highPrice: tickToPrice(tickUpper, DECIMALS_A, DECIMALS_B),
      liquidity,
      tokenMaxA: caps?.tokenMaxA ?? null,
      tokenMaxB: caps?.tokenMaxB ?? null,
      requiredMarginUsdc: side === "long" && marketRiskFields ? requiredMargin(marketRiskFields, liquidity) : null,
      freeUsdc: side === "long" && userCollateral ? BigInt(userCollateral.balanceB.toString()) : null,
      premiumPerHourUsdc: side === "long" && marketRiskFields ? estPremiumPerHour(marketRiskFields, liquidity) : null,
      needsRent: !!tickArrayStatus && (!tickArrayStatus.lowerExists || !tickArrayStatus.upperExists),
    };
  }

  return { side, disabledReason, busy, summary, handleOpen };
}
