import { create } from "zustand";
import type { PublicKey } from "@solana/web3.js";
import type {
  GlobalPremiumIndexAccount,
  MarketAccount,
  PositionWithPubkey,
  RangePremiumStateAccount,
  UserCollateralAccount,
} from "../lib/accounts";
import type { WhirlpoolSpot } from "../lib/whirlpool";

/**
 * All chain-derived READ state lives here, in one store. Writes (deposit,
 * mint, burn, settle, withdraw) go through `hooks/useSendPermaTx.ts`, which
 * calls `refetchAll` immediately after every confirmed transaction rather
 * than waiting for the next poll tick — see that hook for the full
 * freshness policy. There is no indexer and no websocket subscription in
 * this MVP (component 11 is out of scope); this store is intentionally the
 * whole data layer.
 */

export type ConnectionStatus = "ok" | "unreachable";

interface RangeKey {
  tickLower: number;
  tickUpper: number;
}

function rangeKey({ tickLower, tickUpper }: RangeKey): string {
  return `${tickLower}:${tickUpper}`;
}

interface ChainState {
  connectionStatus: ConnectionStatus;
  marketPubkey: PublicKey | null;
  market: MarketAccount | null;
  userCollateral: UserCollateralAccount | null;
  positions: PositionWithPubkey[];
  rangeStates: Record<string, RangePremiumStateAccount>;
  premiumIndex: GlobalPremiumIndexAccount | null;
  spot: WhirlpoolSpot | null;
  lastRefreshedAt: number;

  setConnectionStatus: (s: ConnectionStatus) => void;
  setMarketPubkey: (pk: PublicKey | null) => void;
  setMarket: (m: MarketAccount | null) => void;
  setUserCollateral: (u: UserCollateralAccount | null) => void;
  setPositions: (p: PositionWithPubkey[]) => void;
  setRangeState: (range: RangeKey, s: RangePremiumStateAccount) => void;
  setPremiumIndex: (i: GlobalPremiumIndexAccount | null) => void;
  setSpot: (s: WhirlpoolSpot | null) => void;
  touchRefreshedAt: () => void;
  reset: () => void;
}

const initial = {
  connectionStatus: "ok" as ConnectionStatus,
  marketPubkey: null,
  market: null,
  userCollateral: null,
  positions: [] as PositionWithPubkey[],
  rangeStates: {} as Record<string, RangePremiumStateAccount>,
  premiumIndex: null,
  spot: null,
  lastRefreshedAt: 0,
};

export const useChainStore = create<ChainState>((set) => ({
  ...initial,
  setConnectionStatus: (s) => set({ connectionStatus: s }),
  setMarketPubkey: (pk) => set({ marketPubkey: pk }),
  setMarket: (m) => set({ market: m }),
  setUserCollateral: (u) => set({ userCollateral: u }),
  setPositions: (p) => set({ positions: p }),
  setRangeState: (range, s) =>
    set((state) => ({
      rangeStates: { ...state.rangeStates, [rangeKey(range)]: s },
    })),
  setPremiumIndex: (i) => set({ premiumIndex: i }),
  setSpot: (s) => set({ spot: s }),
  touchRefreshedAt: () => set({ lastRefreshedAt: Date.now() }),
  reset: () => set(initial),
}));

export function selectOpenLongs(state: ChainState): PositionWithPubkey[] {
  return state.positions.filter((p) => p.legType === 1 && p.status === 0);
}

export function selectRangeState(
  state: ChainState,
  tickLower: number,
  tickUpper: number
): RangePremiumStateAccount | undefined {
  return state.rangeStates[rangeKey({ tickLower, tickUpper })];
}

export { rangeKey };
