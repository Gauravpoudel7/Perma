import { describe, expect, it } from "vitest";
import { localnetFundingStatus } from "../src/lib/localnetFunding";

const FUNDED = "7eDWS2L8mHFJtzDECyMBwNkYkhV1xvWewRKxPUg4ELnY";
const OTHER = "A728HNbbk6AjiqTsqNt5FbD7cz7xNpeXrx35qetgLcmX";

describe("localnetFundingStatus", () => {
  it("says nothing on devnet, whatever is connected", () => {
    expect(
      localnetFundingStatus({ cluster: "devnet", fundedWallet: FUNDED, connectedWallet: OTHER })
    ).toBe("n/a");
  });

  it("says nothing until a wallet is connected", () => {
    expect(
      localnetFundingStatus({ cluster: "localnet", fundedWallet: FUNDED, connectedWallet: null })
    ).toBe("n/a");
  });

  it("reports unconfigured when nobody synced the fixture address", () => {
    expect(
      localnetFundingStatus({ cluster: "localnet", fundedWallet: null, connectedWallet: OTHER })
    ).toBe("unconfigured");
  });

  it("matches the funded wallet, and flags any other", () => {
    expect(
      localnetFundingStatus({ cluster: "localnet", fundedWallet: FUNDED, connectedWallet: FUNDED })
    ).toBe("funded");
    expect(
      localnetFundingStatus({ cluster: "localnet", fundedWallet: FUNDED, connectedWallet: OTHER })
    ).toBe("mismatch");
  });
});
