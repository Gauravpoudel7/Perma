"use client";

import { Sidenav } from "./Sidenav";
import { TopBar } from "./TopBar";
import { PrototypeBanner, BANNER_HEIGHT_PX } from "./PrototypeBanner";
import { ClusterGuard } from "../wallet/ClusterGuard";
import { useMarket } from "../../hooks/useMarket";
import { useUserCollateral } from "../../hooks/useUserCollateral";
import { usePositions } from "../../hooks/usePositions";
import { usePremiumIndex } from "../../hooks/usePremiumIndex";

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

  return (
    <div className="flex min-h-dvh flex-col">
      <ClusterGuard />
      <div className="flex flex-1">
        <Sidenav />
        <div className="flex flex-1 flex-col">
          <TopBar />
          <main
            className="flex-1 overflow-y-auto p-6"
            style={{ paddingBottom: `calc(${BANNER_HEIGHT_PX}px + 1.5rem)` }}
          >
            {children}
          </main>
        </div>
      </div>
      <PrototypeBanner />
    </div>
  );
}
