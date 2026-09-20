"use client";

import { useState } from "react";
import { Keypair } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Button } from "../primitives/Button";
import { useSendPermaTx, fetchFreshOpenLongs } from "../../hooks/useSendPermaTx";
import { usePermaProgram } from "../../hooks/usePermaProgram";
import { useWalletGuard } from "../../hooks/useWalletGuard";
import { useChainStore } from "../../store/useChainStore";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useRangeState } from "../../hooks/useRangeState";
import { buildMintPositionIx } from "../../lib/perma";
import { resolveMintShortOrcaAccounts } from "../../lib/resolvePosition";
import { marketAuthorityPda } from "../../lib/pda";
import { buildMissingTickArrayIxs, type TickArrayStatus } from "../../lib/tickArray";
import { slippageCappedTokenMax } from "../../lib/liquidityMath";
import { canMintLong, projectedIndex, requiredFreeUsdc } from "../../lib/solvency";
import { WHIRLPOOL, MAX_OPEN_LONGS } from "../../lib/constants";
import { useOpenLongs } from "../../hooks/useOpenLongs";

export function OpenPositionButton({
  tickArrayStatus,
}: {
  tickArrayStatus: TickArrayStatus | null;
}) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = usePermaProgram();
  const { send } = useSendPermaTx();
  const { canTransact, reason } = useWalletGuard();
  const market = useChainStore((s) => s.market);
  const marketPubkey = useChainStore((s) => s.marketPubkey);
  const userCollateral = useChainStore((s) => s.userCollateral);
  const premiumIndex = useChainStore((s) => s.premiumIndex);
  const spot = useChainStore((s) => s.spot);
  const openLongsDisplay = useOpenLongs();

  const side = useTradeFormStore((s) => s.side);
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  const sizeInput = useTradeFormStore((s) => s.sizeInput);
  const setSizeInput = useTradeFormStore((s) => s.setSizeInput);
  const rangeState = useRangeState(tickLower, tickUpper);
  const [busy, setBusy] = useState(false);

  let liquidity: bigint | null = null;
  try {
    liquidity = sizeInput ? BigInt(sizeInput) : null;
  } catch {
    liquidity = null;
  }

  const available = rangeState
    ? BigInt(rangeState.totalShortLiquidity.toString()) - BigInt(rangeState.totalLongLiquidity.toString())
    : 0n;

  let disabledReason: string | null = null;
  if (!canTransact) disabledReason = reason;
  else if (!liquidity || liquidity <= 0n) disabledReason = "Enter a position size.";
  else if (side === "long" && available <= 0n) disabledReason = "No inventory in this range.";
  else if (side === "long" && liquidity > available) disabledReason = "Exceeds available inventory.";
  else if (side === "long" && openLongsDisplay.length >= MAX_OPEN_LONGS)
    disabledReason = "You've reached the maximum of 8 open longs.";
  else if (side === "long" && market && userCollateral) {
    const marketRiskFields = {
      longMarginHorizonSlots: BigInt(market.longMarginHorizonSlots.toString()),
      premiumRate: BigInt(market.premiumRate.toString()),
      premiumMultiplier: BigInt(market.premiumMultiplier.toString()),
      longMarginBufferUsdc: BigInt(market.longMarginBufferUsdc.toString()),
    };
    const projected = premiumIndex
      ? projectedIndex(
          { currentIndex: BigInt(premiumIndex.currentIndex.toString()), lastUpdateSlot: BigInt(premiumIndex.lastUpdateSlot.toString()) },
          marketRiskFields.premiumRate,
          BigInt(premiumIndex.lastUpdateSlot.toString())
        )
      : 0n;
    const existingRequired = requiredFreeUsdc(
      BigInt(userCollateral.premiumOwedUsdc.toString()),
      openLongsDisplay.map((p) => ({
        accruedScaled: BigInt(p.accruedScaled.toString()),
        entryIndex: BigInt(p.entryIndex.toString()),
        liquidity: BigInt(p.liquidity.toString()),
      })),
      projected,
      marketRiskFields
    );
    const freeB = BigInt(userCollateral.balanceB.toString());
    if (!canMintLong(freeB, existingRequired, liquidity, marketRiskFields)) {
      disabledReason = "Your free USDC can't cover this long's required margin.";
    }
  }

  async function handleOpen() {
    if (!publicKey || !market || !marketPubkey || !liquidity) return;
    setBusy(true);
    try {
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
        });

        await send([...tickArrayIxs, mintIx], {
          successMessage: "Position opened.",
          extraSigners: [positionMint],
        });
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
          existingOpenLongs: freshOpenLongs,
        });
        await send([mintIx], { successMessage: "Position opened." });
      }
      setSizeInput("");
    } finally {
      setBusy(false);
    }
  }

  const label = side === "short" ? "Open Short" : "Open Long";

  return (
    <Button
      className="w-full"
      disabled={disabledReason !== null || busy}
      onClick={handleOpen}
      title={disabledReason ?? undefined}
    >
      {busy ? "Confirm in your wallet" : label}
    </Button>
  );
}
