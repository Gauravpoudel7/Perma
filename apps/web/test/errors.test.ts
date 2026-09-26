import { describe, expect, it } from "vitest";
import { nameForCustomCode, PERMA_ERROR_COPY, parseAnchorError } from "../src/lib/errors";
import { StalePriceError } from "../src/lib/txSequence";

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
  // P3 (ADR-0004). The P1 admin-only errors are not user-facing, so not listed.
  "OracleUnavailable", "OracleStale", "OracleConfidenceTooWide", "OracleDeviationTooHigh",
  // P4 (ADR-0005).
  "AccountSolvent", "NotExercisable", "SelfTarget",
];

describe("PERMA_ERROR_COPY", () => {
  it("has an entry for every PermaError variant, with no generic fallback text", () => {
    for (const name of ALL_VARIANTS) {
      expect(PERMA_ERROR_COPY[name], `missing copy for ${name}`).toBeTruthy();
      expect(PERMA_ERROR_COPY[name]).not.toMatch(/something went wrong/i);
    }
  });

  it("has exactly 42 entries — no stray or duplicate keys", () => {
    expect(Object.keys(PERMA_ERROR_COPY).length).toBe(42);
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

  it("maps a Phantom 'Unexpected error' whose logs only carry 6024", () => {
    const parsed = parseAnchorError({
      name: "WalletSendTransactionError",
      message: "Unexpected error",
      error: {
        message: "Unexpected error",
        transactionMessage: "Error processing Instruction 0: custom program error: 0x1788",
        logs: [
          "Program 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt invoke [1]",
          "Program 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt failed: custom program error: 0x1788",
        ],
      },
    });
    expect(parsed.name).toBe("UnexpectedRemainingAccounts");
    expect(parsed.message).toBe(PERMA_ERROR_COPY.UnexpectedRemainingAccounts);
  });

  it("maps Error Number 6024 when the Anchor name is absent", () => {
    const parsed = parseAnchorError({
      message: "Unexpected error",
      logs: ["Program log: AnchorError occurred. Error Number: 6024. Error Message: Unexpected remaining accounts supplied."],
    });
    expect(parsed.name).toBe("UnexpectedRemainingAccounts");
    expect(parsed.message).toBe(PERMA_ERROR_COPY.UnexpectedRemainingAccounts);
  });

  it("does not treat an unrelated 6024 amount as UnexpectedRemainingAccounts", () => {
    const parsed = parseAnchorError(new Error("Transfer: insufficient lamports 6024, need 1000000"));
    expect(parsed.name).toBe("WalletInsufficientFunds");
  });
});

describe("localnet funding failures", () => {
  // The real shape: the adapter throws "Unexpected error" with the useful
  // failure nested on `.error`, exactly as Phantom reports a failed simulation.
  const wrapped = (message: string, logs: string[] = []) => ({
    name: "WalletSendTransactionError",
    message: "Unexpected error",
    error: { message, logs },
  });

  it.each([
    ["insufficient funds", "Transfer: insufficient lamports 0, need 1000000"],
    ["rent shortfall", "Transaction results in an account with insufficient funds for rent"],
    ["missing token account", "Program log: Error: could not find account"],
  ])("maps %s to the localnet fixture message", (_label, message) => {
    const parsed = parseAnchorError(wrapped(message));
    expect(parsed.name).toBe("WalletInsufficientFunds");
    expect(parsed.message).toContain("Fixtures fund the CLI wallet only");
  });

  it("maps the SPL token program's own insufficient-funds code from logs", () => {
    const parsed = parseAnchorError(
      wrapped("Transaction simulation failed", [
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]",
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1",
      ])
    );
    expect(parsed.name).toBe("WalletInsufficientFunds");
  });
});

describe("OracleStale behind Phantom's generic error", () => {
  it("maps 6038 / 0x1796 in any printed shape to the approval-time copy", () => {
    for (const text of [
      "custom program error: 0x1796",
      'Transaction simulation failed: {"InstructionError":[0,{"Custom":6038}]}',
      "failed: Custom(6038)",
      "Error Number: 6038. Error Message: Oracle price is too old.",
    ]) {
      const e = Object.assign(new Error("Unexpected error"), { error: new Error(text) });
      expect(parseAnchorError(e)).toEqual({ name: "OracleStale", message: PERMA_ERROR_COPY.OracleStale });
    }
    expect(PERMA_ERROR_COPY.OracleStale).toMatch(/too old while you were approving/);
  });

  it("maps every PermaError code from the IDL, and ignores codes that are not PERMA's", () => {
    expect(nameForCustomCode("custom program error: 0x1788")).toBe("UnexpectedRemainingAccounts"); // 6024
    expect(nameForCustomCode('{"Custom":6040}')).toBe("OracleDeviationTooHigh");
    expect(nameForCustomCode("custom program error: 0x1")).toBeNull(); // SPL Token, not PERMA
    // P4 codes come from the deployed IDL too.
    expect(nameForCustomCode('{"Custom":6041}')).toBe("AccountSolvent");
    expect(nameForCustomCode("custom program error: 0x179a")).toBe("NotExercisable"); // 6042
    expect(nameForCustomCode("Custom(6043)")).toBe("SelfTarget");
  });

  it("names the error from simulation logs when the wallet only says Unexpected error", () => {
    const logs = [
      "Program 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt invoke [1]",
      "Program log: AnchorError occurred. Error Code: OracleStale. Error Number: 6038. Error Message: Oracle price is too old.",
      "Program 4qhBfpjfLUSgaSBNEM9aBQw9FbN2QysqLUgkUtM6HDdt failed: custom program error: 0x1796",
    ];
    const e = Object.assign(new Error("Simulation failed"), { logs });
    expect(parseAnchorError(e).name).toBe("OracleStale");
  });

  it("passes the re-post prompt through as written", () => {
    const msg = "The price got too old while you were approving. Approve once more to post a fresh one.";
    expect(parseAnchorError(new StalePriceError(msg)).message).toBe(msg);
  });
});
