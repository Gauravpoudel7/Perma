import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchHealth,
  fetchHistory,
  fetchMarkets,
  fetchPremiumSeries,
  indexerConfigured,
} from "../src/lib/indexerApi";

/**
 * The indexer is an untrusted cache. These tests are almost all about refusal:
 * a response this client does not fully recognise must resolve to `null` so the
 * UI degrades to its RPC polls, never to a half-parsed object that could be
 * rendered as if it were fact.
 */

const WATERMARK = { slot: 42, signature: "sig", lastIngestAt: 1, lastError: null, historyComplete: true };

function respondWith(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("indexerApi", () => {
  it("is configured from NEXT_PUBLIC_INDEXER_URL", () => {
    expect(indexerConfigured).toBe(true);
  });

  it("returns null when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect(await fetchHealth()).toBeNull();
    expect(await fetchMarkets()).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    respondWith({ watermarkSlot: 1, historyComplete: true }, false);
    expect(await fetchHealth()).toBeNull();
  });

  it("parses a well-formed health response", async () => {
    respondWith({ ...WATERMARK, watermarkSlot: 42, finalizedSlot: 50, lagSlots: 8, eventCount: 3 });
    const health = await fetchHealth();
    expect(health?.lagSlots).toBe(8);
    expect(health?.historyComplete).toBe(true);
  });

  it("rejects a market row that is missing its addresses", async () => {
    respondWith({ watermark: WATERMARK, markets: [{ whirlpool: "pool" }] });
    expect(await fetchMarkets()).toBeNull();
  });

  it("keeps wide liquidity values as exact decimal strings", async () => {
    respondWith({
      watermark: WATERMARK,
      markets: [
        {
          market: "MKT",
          whirlpool: "POOL",
          isPaused: false,
          tickSpacing: 8,
          premiumRate: "340282366920938463463374607431768211455",
          premiumMultiplier: "2",
          snapshotSlot: 42,
        },
      ],
    });
    const result = await fetchMarkets();
    expect(result?.markets[0]?.premiumRate).toBe("340282366920938463463374607431768211455");
  });

  it("rejects a premium point that is not traceable to a real source", async () => {
    respondWith({
      watermark: WATERMARK,
      points: [{ slot: 1, blockTime: 1, indexValue: "10", source: "estimated" }],
    });
    expect(await fetchPremiumSeries()).toBeNull();
  });

  it("accepts an empty premium series rather than inventing points", async () => {
    respondWith({ watermark: WATERMARK, points: [] });
    expect(await fetchPremiumSeries()).toEqual({ watermark: WATERMARK, points: [] });
  });

  it("refuses history that claims a liquidation happened", async () => {
    respondWith({
      watermark: WATERMARK,
      closedPositions: [],
      settlements: [],
      collateral: [],
      liquidations: [{ owner: "someone" }],
    });
    expect(await fetchHistory("OWNER")).toBeNull();
  });

  it("refuses a history row with no transaction signature to verify it against", async () => {
    respondWith({
      watermark: WATERMARK,
      closedPositions: [],
      settlements: [{ legType: 1, amount: "5", stillOwed: "0", slot: 9, blockTime: null }],
      collateral: [],
      liquidations: [],
    });
    expect(await fetchHistory("OWNER")).toBeNull();
  });

  it("accepts a well-formed history", async () => {
    respondWith({
      watermark: WATERMARK,
      closedPositions: [],
      settlements: [{ signature: "sigSettle", legType: 1, amount: "5", stillOwed: "0", slot: 9, blockTime: null }],
      collateral: [],
      liquidations: [],
    });
    const history = await fetchHistory("OWNER");
    expect(history?.settlements[0]?.signature).toBe("sigSettle");
    expect(history?.liquidations).toEqual([]);
  });
});
