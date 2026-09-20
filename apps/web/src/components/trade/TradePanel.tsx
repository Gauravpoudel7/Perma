"use client";

import { useState } from "react";
import { MarketHeader } from "./MarketHeader";
import { SideToggle } from "./SideToggle";
import { RangeInput } from "./RangeInput";
import { SizeInput } from "./SizeInput";
import { PremiumPreview } from "./PremiumPreview";
import { OpenPositionButton } from "./OpenPositionButton";
import type { TickArrayStatus } from "../../lib/tickArray";

/** COPY-DECK §4.1 header "Open Position", market label, and the full form. */
export function TradePanel() {
  const [tickArrayStatus, setTickArrayStatus] = useState<TickArrayStatus | null>(null);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-h2 mb-6 text-text-primary">Open Position</h1>
      <div className="flex flex-col gap-6 rounded-md border border-border bg-surface p-6">
        <MarketHeader />
        <SideToggle />
        <RangeInput onTickArrayStatus={(status) => setTickArrayStatus(status)} />
        <SizeInput />
        <PremiumPreview />
        <OpenPositionButton tickArrayStatus={tickArrayStatus} />
      </div>
    </div>
  );
}
