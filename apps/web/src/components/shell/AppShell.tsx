"use client";

import { Sidenav } from "./Sidenav";
import { TopBar } from "./TopBar";
import { MobileTabBar } from "./MobileTabBar";
import { PrototypeBanner } from "./PrototypeBanner";
import { ClusterGuard } from "../wallet/ClusterGuard";
import { useMarket } from "../../hooks/useMarket";
import { useUserCollateral } from "../../hooks/useUserCollateral";
import { usePositions } from "../../hooks/usePositions";
import { usePremiumIndex } from "../../hooks/usePremiumIndex";
import { useSpotPrice } from "../../hooks/useSpotPrice";

/**
 * The read hooks that every screen needs are mounted once here, not
 * per-page — Market/UserCollateral/Positions/PremiumIndex are relevant on
 * all three routes (Trade needs inventory + solvency inputs, Portfolio
 * needs positions, Vault needs collateral + solvency inputs).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  useMarket();
  useUserCollateral();
  usePositions();
  usePremiumIndex();
  useSpotPrice();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus-ring sr-only rounded-md bg-text-primary px-4 py-3 text-button text-bg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60]"
      >
        Skip to content
      </a>
      <ClusterGuard />
      <div className="flex flex-1">
        <Sidenav />
        <div className="flex flex-1 flex-col">
          <TopBar />
          {/* Bottom padding clears the fixed chrome: tab bar + banner on phones, banner alone from md. */}
          <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-4 pb-[calc(var(--shell-banner-h)+var(--shell-tabbar-h)+1rem)] md:p-6 md:pb-[calc(var(--shell-banner-h)+1.5rem)]">
            {children}
          </main>
        </div>
      </div>
      {/* One fixed bottom stack: tab bar (phones only) over the banner. Above sheets (z-50, later in DOM). */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col">
        <MobileTabBar />
        <PrototypeBanner />
      </div>
    </div>
  );
}
