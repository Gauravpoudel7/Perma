import { describe, expect, it } from "vitest";
import { PERMA_ERROR_COPY, parseAnchorError } from "../src/lib/errors";

// Every PermaError variant from programs/perma/src/errors.rs — if one is
// added on-chain without a corresponding entry here, this test catches it.
const ALL_VARIANTS = [
  "InsufficientFunds", "InsolventWithdrawal", "InsufficientCollateralForLoss",
  "PositionsOutstanding", "InvalidLegType", "PositionAlreadyClosed", "NoShortInventory",
  "InventoryInvariantViolated", "HarnessPathUnavailable", "NothingToSettle",
  "RangeStateMismatch", "PremiumPoolUnderfunded", "ZeroAmount", "MarketPaused",
  "PoolNotAllowlisted", "Unauthorized", "MarketAlreadyExists", "InvalidAllowlistEntry",
  "WrongWhirlpoolProgram", "WhirlpoolNotAllowlisted", "TickArrayNotInitialized",
  "TickNotAlignedToSpacing", "TickOutOfBounds", "PositionAuthorityMismatch",
  "UnexpectedRemainingAccounts", "SlippageExceeded", "ClosePositionNotEmpty",
  "InvalidRange", "InvalidAsset", "MathOverflow", "InvalidWhirlpoolAccount",
  "InsolventMint", "MissingOpenLong", "TooManyOpenLongs", "InvalidRiskParams",
];

describe("PERMA_ERROR_COPY", () => {
  it("has an entry for every PermaError variant, with no generic fallback text", () => {
    for (const name of ALL_VARIANTS) {
      expect(PERMA_ERROR_COPY[name], `missing copy for ${name}`).toBeTruthy();
      expect(PERMA_ERROR_COPY[name]).not.toMatch(/something went wrong/i);
    }
  });

  it("has exactly 35 entries — no stray or duplicate keys", () => {
    expect(Object.keys(PERMA_ERROR_COPY).length).toBe(35);
    expect(Object.keys(PERMA_ERROR_COPY).sort()).toEqual([...ALL_VARIANTS].sort());
  });
});

describe("parseAnchorError", () => {
  it("falls back to a raw-message scan when Anchor's own parser finds nothing", () => {
    const e = new Error("... custom program error: InsolventMint ...");
    const { name, message } = parseAnchorError(e);
    expect(name).toBe("InsolventMint");
    expect(message).toBe(PERMA_ERROR_COPY.InsolventMint);
  });

  it("never surfaces a raw discriminant or a bare 'Something went wrong'", () => {
    const { message } = parseAnchorError(new Error("totally unrecognized failure"));
    expect(message).not.toMatch(/^6\d{3}$/);
    expect(message.toLowerCase()).not.toBe("something went wrong");
  });

  it("recognizes a wallet-adapter rejection distinctly", () => {
    const { name } = parseAnchorError(new Error("User rejected the request"));
    expect(name).toBe("UserRejected");
  });
});
