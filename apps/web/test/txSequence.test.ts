import { describe, expect, it } from "vitest";
import { openStepLabels, runSequence, sequenceToast, stepLabel, StalePriceError, type SequenceStep } from "../src/lib/txSequence";

const steps = (...names: string[]): SequenceStep<string>[] => names.map((n) => ({ label: n, tx: n }));

describe("runSequence", () => {
  it("sends every step in order", async () => {
    const sent: string[] = [];
    const r = await runSequence(steps("post", "mint", "reclaim"), async (tx) => (sent.push(tx), `sig-${tx}`));
    expect(sent).toEqual(["post", "mint", "reclaim"]);
    expect(r).toMatchObject({ ok: true, failedAt: null, cleanupFailed: false });
    expect(r.signatures).toEqual(["sig-post", "sig-mint", "sig-reclaim"]);
  });

  it("a failed post never lets the mint go out, but the rent reclaim still does", async () => {
    const s = steps("post", "mint", "reclaim");
    s[2]!.always = true;
    const sent: string[] = [];
    const r = await runSequence(s, async (tx) => {
      if (tx === "post") throw new Error("verify failed");
      sent.push(tx);
      return `sig-${tx}`;
    });
    expect(sent).toEqual(["reclaim"]);
    expect(r.ok).toBe(false);
    expect(r.failedAt).toBe(0);
    expect(r.signatures).toEqual([null, null, "sig-reclaim"]);
  });

  it("a stale price fails the mint before it is sent; the failure is the mint's, not the cleanup's", async () => {
    const s = steps("post", "mint", "reclaim");
    s[1]!.check = async () => {
      throw new StalePriceError("too old");
    };
    s[2]!.always = true;
    const sent: string[] = [];
    const r = await runSequence(s, async (tx) => (sent.push(tx), tx));
    expect(sent).toEqual(["post", "reclaim"]);
    expect(r.failedAt).toBe(1);
    expect(r.error).toBeInstanceOf(StalePriceError);
    expect(r.cleanupFailed).toBe(false);
  });

  it("a failed reclaim after a good mint is still ok, flagged as cleanup only", async () => {
    const s = steps("post", "mint", "reclaim");
    s[2]!.always = true;
    const r = await runSequence(s, async (tx) => {
      if (tx === "reclaim") throw new Error("rent");
      return tx;
    });
    expect(r).toMatchObject({ ok: true, failedAt: null, cleanupFailed: true });
  });

  it("reports progress as Step N of M", async () => {
    const seen: string[] = [];
    await runSequence(steps("a", "b"), async (tx) => tx, (i, n, label) => seen.push(stepLabel(i, n, label)));
    expect(seen).toEqual(["Step 1 of 2: a", "Step 2 of 2: b"]);
  });
});

describe("openStepLabels", () => {
  it("fresh sponsored price, no rent: just the mint", () => {
    expect(openStepLabels({ rent: false, pythTxs: 0, side: "long" })).toEqual(["Open the long"]);
  });
  it("a Pyth post of 5 transactions and rent: 8 steps, reclaim last", () => {
    const l = openStepLabels({ rent: true, pythTxs: 5, side: "short" });
    expect(l).toHaveLength(8);
    expect(l[0]).toMatch(/tick array/);
    expect(l.slice(1, 4)).toEqual(Array(3).fill("Upload Pyth price data"));
    expect(l[4]).toBe("Verify the Pyth price");
    expect(l[5]).toBe("Post the Pyth price");
    expect(l[6]).toBe("Open the short");
    expect(l[7]).toBe("Reclaim the Pyth rent");
  });
});

describe("sequenceToast", () => {
  const opts = { successMessage: "Position opened.", failureMessage: "No position was opened.", errorText: "Oracle stale" };
  const base = { signatures: [], failedAt: null, error: null, cleanupFailed: false };

  it("a failed mint whose rent reclaim succeeded leaves only an error, never a success", () => {
    const t = sequenceToast({ ...base, ok: false, failedAt: 5, signatures: ["a", "b", "c", "d", "e", null, "r"] }, opts);
    expect(t.variant).toBe("error");
    expect(t.message).toBe("Transaction failed: Oracle stale. No position was opened.");
    expect(t.message).not.toMatch(/closed|reclaimed\./);
  });

  it("error copy that ends in a period is not doubled", () => {
    const t = sequenceToast({ ...base, ok: false, failedAt: 0, signatures: [null] }, { ...opts, errorText: "Transaction cancelled." });
    expect(t.message).toBe("Transaction failed: Transaction cancelled. Nothing was changed.");
  });

  it("nothing sent (wallet rejected) says nothing changed", () => {
    const t = sequenceToast({ ...base, ok: false, failedAt: 0, signatures: [null, null] }, opts);
    expect(t.message).toBe("Transaction failed: Oracle stale. Nothing was changed.");
  });

  it("a failed reclaim is one neutral sentence on the real outcome", () => {
    expect(sequenceToast({ ...base, ok: true, cleanupFailed: true, signatures: ["m", null] }, opts)).toEqual({
      variant: "success",
      message: "Position opened. Pyth rent was not reclaimed.",
    });
    expect(
      sequenceToast({ ...base, ok: false, failedAt: 1, cleanupFailed: true, signatures: ["p", null, null] }, opts).message
    ).toBe("Transaction failed: Oracle stale. No position was opened. Pyth rent was not reclaimed.");
  });
});
