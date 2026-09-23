import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloseSettleView } from "../src/components/portfolio/CloseSettleView";
import { LEG_LONG, LEG_SHORT, STATUS_OPEN, STATUS_PENDING_PREMIUM } from "../src/lib/constants";
import { PERMA_ERROR_COPY } from "../src/lib/errors";
import {
  AWAITING_PREMIUM_COPY,
  PENDING_SETTLE_CLOSES_COPY,
  pendingPremiumNote,
  positionActions,
} from "../src/lib/positionActions";
import { SETTLE_DUST_USDC_MICRO } from "../src/lib/solvency";

function markup(input: Parameters<typeof positionActions>[0]) {
  const actions = positionActions(input);
  return renderToStaticMarkup(
    createElement(CloseSettleView, {
      actions,
      shortPayable: input.shortPayable,
      busy: null,
      disabled: false,
      onClose: () => {},
      onSettle: () => {},
    })
  );
}

describe("positionActions", () => {
  it("keeps an open short on Close only, even when the escrow could pay", () => {
    const actions = positionActions({
      legType: LEG_SHORT,
      status: STATUS_OPEN,
      accrued: 5_000_000n,
      shortPayable: 5_000_000n,
    });
    expect(actions).toEqual({
      showClose: true,
      showSettle: false,
      awaitingPremium: false,
      settleClosesAccount: false,
      partialSettle: false,
    });
  });

  it("keeps the U9 dust floor on open longs and still offers Close below it", () => {
    const below = positionActions({
      legType: LEG_LONG,
      status: STATUS_OPEN,
      accrued: SETTLE_DUST_USDC_MICRO - 1n,
      shortPayable: null,
    });
    expect(below.showClose).toBe(true);
    expect(below.showSettle).toBe(false);

    const at = positionActions({
      legType: LEG_LONG,
      status: STATUS_OPEN,
      accrued: SETTLE_DUST_USDC_MICRO,
      shortPayable: null,
    });
    expect(at.showClose).toBe(true);
    expect(at.showSettle).toBe(true);
    expect(at.settleClosesAccount).toBe(false);
  });

  it("hides Close on a pending-premium short and waits while the escrow is empty or unknown", () => {
    for (const shortPayable of [0n, null]) {
      const actions = positionActions({
        legType: LEG_SHORT,
        status: STATUS_PENDING_PREMIUM,
        accrued: 5_000n,
        shortPayable,
      });
      expect(actions.showClose).toBe(false);
      expect(actions.showSettle).toBe(false);
      expect(actions.awaitingPremium).toBe(true);
    }
  });

  it("offers Settle for a pending-premium short below the long dust floor when the escrow can pay", () => {
    const partial = positionActions({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 1n,
    });
    expect(partial.showClose).toBe(false);
    expect(partial.showSettle).toBe(true);
    expect(partial.partialSettle).toBe(true);
    expect(partial.settleClosesAccount).toBe(false);

    const full = positionActions({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 5_000n,
    });
    expect(full.showSettle).toBe(true);
    expect(full.showClose).toBe(false);
    expect(full.settleClosesAccount).toBe(true);
    expect(full.partialSettle).toBe(false);
  });

  it("does not offer Close or Settle for a pending long", () => {
    const actions = positionActions({
      legType: LEG_LONG,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 5_000n,
    });
    expect(actions.showClose).toBe(false);
    expect(actions.showSettle).toBe(false);
    expect(actions.awaitingPremium).toBe(true);
  });
});

describe("pending premium copy", () => {
  it("starts from the NothingToSettle sentence", () => {
    const nothing = PERMA_ERROR_COPY.NothingToSettle;
    expect(nothing).toBe("There is nothing to settle yet.");
    expect(AWAITING_PREMIUM_COPY.startsWith(nothing ?? "")).toBe(true);
    expect(pendingPremiumNote(
      positionActions({
        legType: LEG_SHORT,
        status: STATUS_PENDING_PREMIUM,
        accrued: 5_000n,
        shortPayable: 0n,
      }),
      "0"
    )).toBe(AWAITING_PREMIUM_COPY);
  });

  it("names a partial payment and a settle that closes the account", () => {
    const partial = positionActions({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 1n,
    });
    expect(pendingPremiumNote(partial, "0.000001")).toBe(
      "Range escrow can pay 0.000001 USDC now. The rest stays owed."
    );
    const full = positionActions({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 5_000n,
    });
    expect(pendingPremiumNote(full, "0.005")).toBe(PENDING_SETTLE_CLOSES_COPY);
  });
});

describe("CloseSettleView", () => {
  it("renders no Close button for a size-0 pending-premium short with an empty escrow", () => {
    const html = markup({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 0n,
    });
    expect(html).not.toContain(">Close<");
    expect(html).not.toContain(">Settle<");
    expect(html).toContain("There is nothing to settle yet.");
    expect(html).toContain("Waiting for a long to fund the range escrow.");
  });

  it("renders Settle and not Close when the escrow can pay the whole claim", () => {
    const html = markup({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 5_000n,
    });
    expect(html).toContain(">Settle<");
    expect(html).not.toContain(">Close<");
    expect(html).toContain(PENDING_SETTLE_CLOSES_COPY);
  });

  it("renders Settle for a 1 µUSDC escrow payment, under the long dust floor", () => {
    const html = markup({
      legType: LEG_SHORT,
      status: STATUS_PENDING_PREMIUM,
      accrued: 5_000n,
      shortPayable: 1n,
    });
    expect(html).toContain(">Settle<");
    expect(html).not.toContain(">Close<");
    expect(html).toContain("Range escrow can pay 0.000001 USDC now. The rest stays owed.");
  });

  it("still renders Close for an open short and both actions for a settleable long", () => {
    const shortHtml = markup({
      legType: LEG_SHORT,
      status: STATUS_OPEN,
      accrued: 5_000_000n,
      shortPayable: 5_000_000n,
    });
    expect(shortHtml).toContain(">Close<");
    expect(shortHtml).not.toContain(">Settle<");

    const longHtml = markup({
      legType: LEG_LONG,
      status: STATUS_OPEN,
      accrued: SETTLE_DUST_USDC_MICRO,
      shortPayable: null,
    });
    expect(longHtml).toContain(">Close<");
    expect(longHtml).toContain(">Settle<");

    const dustHtml = markup({
      legType: LEG_LONG,
      status: STATUS_OPEN,
      accrued: SETTLE_DUST_USDC_MICRO - 1n,
      shortPayable: null,
    });
    expect(dustHtml).toContain(">Close<");
    expect(dustHtml).not.toContain(">Settle<");
  });
});
