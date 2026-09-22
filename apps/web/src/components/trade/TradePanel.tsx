"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { MarketHeader } from "./MarketHeader";
import { SideToggle } from "./SideToggle";
import { RangeInput } from "./RangeInput";
import { SizeInput } from "./SizeInput";
import { PremiumPreview } from "./PremiumPreview";
import { OpenPositionButton } from "./OpenPositionButton";
import { IndexedCharts } from "./IndexedCharts";
import { InventoryStrip } from "./InventoryStrip";
import { InventoryPicker } from "./InventoryPicker";
import { OpenPositionsStrip } from "./OpenPositionsStrip";
import { CollateralNudge } from "./CollateralNudge";
import { EmptyState } from "../primitives/States";
import { useTradeFormStore } from "../../store/useTradeFormStore";
import { useRangeStatePoller } from "../../hooks/useRangeState";
import type { TickArrayStatus } from "../../lib/tickArray";

/**
 * The Trade desk (PRODUCT-UI-V2-RESEARCH §3 / §5). One grid, three widths:
 *  - ≥1280px: viz pane (inventory + indexed charts) left, 384px ticket right.
 *  - 768–1279px: stacked, viz above ticket.
 *  - <768px: ticket first — the thing a phone user came to do.
 * The viz pane is public RPC/indexer data and renders without a wallet; only
 * the CTA needs one, and says so with COPY-DECK's connect prompt.
 */
export function TradePanel() {
  const { connected } = useWallet();
  // One poll for the ticket's RangePremiumState; SizeInput, InventoryStrip and the mint preflight read it.
  const tickLower = useTradeFormStore((s) => s.tickLower);
  const tickUpper = useTradeFormStore((s) => s.tickUpper);
  useRangeStatePoller(tickLower, tickUpper);
  const [tickArrayStatus, setTickArrayStatus] = useState<TickArrayStatus | null>(null);
  // Phone-only disclosure for the viz pane; from `md` the pane is always shown (`md:flex` wins).
  const [showViz, setShowViz] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_384px]">
        <aside
          data-testid="trade-ticket"
          aria-label="Order ticket"
          className="order-1 flex flex-col gap-4 rounded-md border border-border bg-surface p-4 md:order-2"
        >
          <CollateralNudge />
          <div>
            <h1 className="text-h4 text-text-primary">Open Position</h1>
            <MarketHeader />
          </div>
          <SideToggle />
          <RangeInput onTickArrayStatus={(status) => setTickArrayStatus(status)} />
          <SizeInput />
          <PremiumPreview />
          {connected ? (
            <OpenPositionButton tickArrayStatus={tickArrayStatus} />
          ) : (
            <EmptyState>Connect a wallet to continue.</EmptyState>
          )}
        </aside>
        <div className="order-2 flex flex-col gap-4 md:order-1 md:contents">
          <button
            type="button"
            aria-expanded={showViz}
            aria-controls="trade-viz"
            onClick={() => setShowViz((v) => !v)}
            className="transition-brand focus-ring flex min-h-[44px] w-full items-center justify-between rounded-md border border-border bg-surface px-4 text-body-md text-text-primary md:hidden"
          >
            <span>Market data</span>
            <span className="text-caption text-text-muted">{showViz ? "Hide" : "Show"}</span>
          </button>
          <section
            id="trade-viz"
            data-testid="trade-viz"
            aria-label="Market data"
            className={`${showViz ? "flex" : "hidden"} flex-col gap-4 md:order-1 md:flex`}
          >
            <InventoryStrip />
            <InventoryPicker />
            <IndexedCharts />
          </section>
        </div>
      </div>
      <OpenPositionsStrip />
    </div>
  );
}
