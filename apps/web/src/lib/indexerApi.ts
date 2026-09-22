/**
 * Client for the P2 read APIs in `indexer/`.
 *
 * The indexer is an untrusted cache, never a balance oracle. Every function
 * here resolves to `null` — never a throw, never a partial object — when the
 * service is unconfigured, unreachable, slow, or answers with a shape this file
 * does not recognise. Callers render an empty or degraded state on `null`; they
 * must not fall back to a guess.
 *
 * Nothing in here may be used to decide whether a transaction is safe to send.
 * Balances and open longs are re-read over RPC immediately before every
 * risk-increasing instruction (`fetchFreshOpenLongs`), and `usePolledAccount`
 * remains the source of truth for live state.
 */

/** Unset means "no indexer" — the app then behaves exactly as it did in Fair. */
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "").replace(/\/$/, "");

export const indexerConfigured = INDEXER_URL.length > 0;

/** A slow indexer is a down indexer: never let it delay a page behind RPC data. */
const TIMEOUT_MS = 4_000;

export interface Watermark {
  slot: number;
  signature: string | null;
  lastIngestAt: number | null;
  lastError: string | null;
  /**
   * False when the ingested log provably does not reach the beginning of a
   * market's life, so every fold-derived sum is too small. Hide inventory
   * rather than draw a number that is quietly wrong.
   */
  historyComplete: boolean;
}

export interface IndexerHealth extends Watermark {
  watermarkSlot: number;
  /** Last slot the sweep examined. Lag is measured against this, not the watermark. */
  sweptThroughSlot: number;
  finalizedSlot: number | null;
  lagSlots: number | null;
  eventCount: number;
}

export interface IndexerMarket {
  market: string;
  whirlpool: string;
  isPaused: boolean | null;
  tickSpacing: number | null;
  premiumRate: string | null;
  premiumMultiplier: string | null;
  snapshotSlot: number;
}

export interface RangeBucket {
  tickLower: number;
  tickUpper: number;
  shortLiquidity: string;
  longLiquidity: string;
}

export interface PremiumPoint {
  slot: number;
  blockTime: number | null;
  indexValue: string;
  /** `event` = a decoded `LongMinted.entry_index`; `poll` = a live account read. */
  source: "event" | "poll";
}

export interface HistoryPosition {
  permaPosition: string;
  legType: number;
  tickLower: number;
  tickUpper: number;
  status: number;
  premiumPaid: string;
  premiumClaimed: string;
  openSlot: number | null;
  openSignature: string | null;
  closeSlot: number | null;
  closeSignature: string | null;
}

export interface HistorySettlement {
  signature: string;
  legType: number;
  amount: string;
  stillOwed: string;
  slot: number;
  blockTime: number | null;
}

export interface HistoryCashEvent {
  signature: string;
  kind: "deposit" | "withdraw" | "lock" | "unlock";
  amountA: string;
  amountB: string;
  slot: number;
  blockTime: number | null;
}

export interface PortfolioHistory {
  watermark: Watermark;
  closedPositions: HistoryPosition[];
  settlements: HistorySettlement[];
  collateral: HistoryCashEvent[];
  /** Always empty in P2. Liquidation is P4 work and does not exist on-chain yet. */
  liquidations: never[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Wide u64/u128 values cross the wire as decimal strings; a number would lose them. */
const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

function isWatermark(v: unknown): v is Watermark {
  return isObject(v) && typeof v.slot === "number" && typeof v.historyComplete === "boolean";
}

async function get(path: string): Promise<unknown | null> {
  if (!indexerConfigured) return null;
  try {
    const res = await fetch(`${INDEXER_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Unreachable, timed out, or not JSON. All of these mean the same thing.
    return null;
  }
}

export async function fetchHealth(): Promise<IndexerHealth | null> {
  const body = await get("/health");
  if (!isObject(body) || typeof body.watermarkSlot !== "number" || typeof body.historyComplete !== "boolean") {
    return null;
  }
  return body as unknown as IndexerHealth;
}

function parseMarket(v: unknown): IndexerMarket | null {
  if (!isObject(v) || typeof v.market !== "string" || typeof v.whirlpool !== "string") return null;
  return {
    market: v.market,
    whirlpool: v.whirlpool,
    isPaused: typeof v.isPaused === "boolean" ? v.isPaused : null,
    tickSpacing: typeof v.tickSpacing === "number" ? v.tickSpacing : null,
    premiumRate: isAmount(v.premiumRate) ? v.premiumRate : null,
    premiumMultiplier: isAmount(v.premiumMultiplier) ? v.premiumMultiplier : null,
    snapshotSlot: typeof v.snapshotSlot === "number" ? v.snapshotSlot : 0,
  };
}

export async function fetchMarkets(): Promise<{ watermark: Watermark; markets: IndexerMarket[] } | null> {
  const body = await get("/markets");
  if (!isObject(body) || !isWatermark(body.watermark) || !Array.isArray(body.markets)) return null;
  const markets = body.markets.map(parseMarket);
  // One bad row means the contract is not what this client thinks it is.
  if (markets.some((m) => m === null)) return null;
  return { watermark: body.watermark, markets: markets as IndexerMarket[] };
}

export async function fetchMarketDetail(
  market: string
): Promise<{ watermark: Watermark; market: IndexerMarket; inventoryByRange: RangeBucket[] } | null> {
  const body = await get(`/markets/${market}`);
  if (!isObject(body) || !isWatermark(body.watermark) || !Array.isArray(body.inventoryByRange)) return null;
  const parsed = parseMarket(body.market);
  if (!parsed) return null;
  const buckets: RangeBucket[] = [];
  for (const b of body.inventoryByRange) {
    if (
      !isObject(b) ||
      typeof b.tickLower !== "number" ||
      typeof b.tickUpper !== "number" ||
      !isAmount(b.shortLiquidity) ||
      !isAmount(b.longLiquidity)
    ) {
      return null;
    }
    buckets.push({
      tickLower: b.tickLower,
      tickUpper: b.tickUpper,
      shortLiquidity: b.shortLiquidity,
      longLiquidity: b.longLiquidity,
    });
  }
  return { watermark: body.watermark, market: parsed, inventoryByRange: buckets };
}

export async function fetchPremiumSeries(): Promise<{ watermark: Watermark; points: PremiumPoint[] } | null> {
  const body = await get("/premium/series");
  if (!isObject(body) || !isWatermark(body.watermark) || !Array.isArray(body.points)) return null;
  const points: PremiumPoint[] = [];
  for (const p of body.points) {
    // An unsourced point is a fabricated point. Reject the whole series.
    if (!isObject(p) || typeof p.slot !== "number" || !isAmount(p.indexValue)) return null;
    if (p.source !== "event" && p.source !== "poll") return null;
    points.push({
      slot: p.slot,
      blockTime: typeof p.blockTime === "number" ? p.blockTime : null,
      indexValue: p.indexValue,
      source: p.source,
    });
  }
  return { watermark: body.watermark, points };
}

export async function fetchHistory(owner: string): Promise<PortfolioHistory | null> {
  const body = await get(`/positions/${owner}/history`);
  if (
    !isObject(body) ||
    !isWatermark(body.watermark) ||
    !Array.isArray(body.closedPositions) ||
    !Array.isArray(body.settlements) ||
    !Array.isArray(body.collateral) ||
    !Array.isArray(body.liquidations)
  ) {
    return null;
  }
  // P2 has no liquidation instruction on-chain. A non-empty array here means
  // this is not the service we think it is, so refuse the whole response.
  if (body.liquidations.length > 0) return null;
  const everyRowHasASignature =
    body.settlements.every((s) => isObject(s) && typeof s.signature === "string") &&
    body.collateral.every((c) => isObject(c) && typeof c.signature === "string") &&
    body.closedPositions.every((p) => isObject(p) && typeof p.closeSignature === "string");
  if (!everyRowHasASignature) return null;
  return body as unknown as PortfolioHistory;
}
