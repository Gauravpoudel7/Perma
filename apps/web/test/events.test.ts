import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  decodePermaEvents,
  describeEvents,
  fetchTxEvents,
  looksLikeEventLog,
  slicesTouchedBy,
  type PermaEvent,
  type PermaEventName,
} from "../src/lib/events";
import { getPermaProgram } from "../src/lib/perma";
import { PERMA_PROGRAM_ID } from "../src/lib/constants";
import idl from "../src/idl/perma.json";

// Offline program: the coder is all we need, no RPC is ever hit.
const wallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(t: T) => t,
  signAllTransactions: async <T>(t: T[]) => t,
};
const program = getPermaProgram(new Connection("http://127.0.0.1:1"), wallet);

/** Anchor's `BorshEventCoder` decodes but does not encode; build the wire bytes by hand. */
function eventLog(name: PermaEventName, data: Record<string, unknown>): string {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  const ev = (idl as { events: Array<{ name: string; discriminator: number[] }> }).events.find(
    (e) => e.name === pascal
  );
  if (!ev) throw new Error(`no IDL event ${pascal}`);
  const body = program.coder.types.encode(name as never, data as never);
  const bytes = Buffer.concat([Buffer.from(ev.discriminator), body]);
  return `Program data: ${bytes.toString("base64")}`;
}

const market = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;

const shortMinted = {
  market,
  owner,
  permaPosition: Keypair.generate().publicKey,
  orcaPosition: Keypair.generate().publicKey,
  tickLower: -40176,
  tickUpper: -38168,
  liquidity: new BN(100_000_000),
  lockedA: new BN(1_000),
  lockedB: new BN(2_000),
  openPositions: 1,
};
const pauseSet = { market, admin: owner };

/** What a real localnet tx log looks like: our events among everything else. */
const realisticLogs = (...events: string[]) => [
  `Program ${PERMA_PROGRAM_ID.toBase58()} invoke [1]`,
  "Program log: Instruction: MintPosition",
  "Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc invoke [2]",
  "Program log: Instruction: OpenPosition",
  "Program data: bm90IGFuIGV2ZW50", // some other program's data line
  "Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc success",
  ...events,
  `Program ${PERMA_PROGRAM_ID.toBase58()} consumed 123456 of 400000 compute units`,
  `Program ${PERMA_PROGRAM_ID.toBase58()} success`,
];

describe("decodePermaEvents", () => {
  it("decodes only PERMA events out of a realistic log stream, in order, with typed fields", () => {
    const logs = realisticLogs(eventLog("shortMinted", shortMinted), eventLog("marketPauseSet", pauseSet));
    const events = decodePermaEvents(program, logs);
    expect(events.map((e) => e.name)).toEqual(["shortMinted", "marketPauseSet"]);

    const minted = events[0]!.data;
    expect((minted.owner as PublicKey).equals(owner)).toBe(true);
    expect((minted.liquidity as BN).toString()).toBe("100000000");
    expect(minted.tickLower).toBe(-40176);
    expect(minted.openPositions).toBe(1);
    expect((events[1]!.data.admin as PublicKey).equals(owner)).toBe(true);
  });

  it("returns [] for logs with no PERMA events, and never throws on garbage", () => {
    expect(decodePermaEvents(program, realisticLogs())).toEqual([]);
    expect(decodePermaEvents(program, ["Program data: !!!not base64!!!", "", "Program log: x"])).toEqual([]);
    expect(decodePermaEvents(program, [])).toEqual([]);
  });

  it("looksLikeEventLog is a cheap prefilter on the two Anchor prefixes", () => {
    expect(looksLikeEventLog("Program data: abc")).toBe(true);
    expect(looksLikeEventLog("Program log: abc")).toBe(true);
    expect(looksLikeEventLog("Program X invoke [1]")).toBe(false);
  });
});

describe("fetchTxEvents", () => {
  const fakeConn = (tx: unknown) =>
    ({ getTransaction: async () => tx }) as unknown as Connection;

  it("returns [] when the tx is not (yet) visible or has no logs", async () => {
    expect(await fetchTxEvents(fakeConn(null), program, "sig")).toEqual([]);
    expect(await fetchTxEvents(fakeConn({ meta: null }), program, "sig")).toEqual([]);
    expect(await fetchTxEvents(fakeConn({ meta: { logMessages: [] } }), program, "sig")).toEqual([]);
  });

  it("returns [] when the RPC throws — the caller's poll path is unaffected", async () => {
    const throwing = { getTransaction: async () => { throw new Error("rpc down"); } } as unknown as Connection;
    expect(await fetchTxEvents(throwing, program, "sig")).toEqual([]);
  });

  it("decodes a real-shaped getTransaction response", async () => {
    const tx = { meta: { logMessages: realisticLogs(eventLog("marketPauseSet", pauseSet)) } };
    const events = await fetchTxEvents(fakeConn(tx), program, "sig");
    expect(events.map((e) => e.name)).toEqual(["marketPauseSet"]);
  });
});

describe("slicesTouchedBy", () => {
  const ev = (name: PermaEventName, data: Record<string, unknown> = {}): PermaEvent => ({ name, data });

  it("a mint touches positions, collateral, premium index, and exactly its range", () => {
    const t = slicesTouchedBy([ev("shortMinted", { tickLower: -40176, tickUpper: -38168 })]);
    expect(t).toMatchObject({ positions: true, collateral: true, premiumIndex: true, market: false, allKnownRanges: false });
    expect(t.ranges).toEqual([[-40176, -38168]]);
  });

  it("a settle or burn names no ticks, so every known range is refreshed", () => {
    const t = slicesTouchedBy([ev("premiumSettled"), ev("longBurned")]);
    expect(t.allKnownRanges).toBe(true);
    expect(t.ranges).toEqual([]);
    expect(t.positions && t.collateral && t.premiumIndex).toBe(true);
  });

  it("collateral events touch only collateral; admin events touch only market", () => {
    expect(slicesTouchedBy([ev("collateralDeposited")])).toMatchObject({
      collateral: true, positions: false, market: false, premiumIndex: false,
    });
    expect(slicesTouchedBy([ev("marketPauseSet"), ev("marketRiskParamsSet")])).toMatchObject({
      market: true, collateral: false, positions: false,
    });
  });

  it("de-duplicates ranges across events and ignores nothing-events", () => {
    const r = { tickLower: 1, tickUpper: 9 };
    const t = slicesTouchedBy([ev("shortMinted", r), ev("longMinted", r), ev("liquidityAdded", r)]);
    expect(t.ranges).toEqual([[1, 9]]);
    expect(slicesTouchedBy([])).toMatchObject({ positions: false, collateral: false, market: false, ranges: [] });
  });
});

describe("describeEvents", () => {
  it("renders PascalCase names for the toast detail line", () => {
    expect(describeEvents([{ name: "shortMinted", data: {} }, { name: "premiumSettled", data: {} }])).toBe(
      "ShortMinted, PremiumSettled"
    );
  });
});
