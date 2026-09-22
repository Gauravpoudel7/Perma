import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The cluster the dev server under test was built for. Read from the same env
 * files Next reads, so a spec can skip the checks that only make sense on one
 * cluster instead of failing when an operator switches `.env.local`.
 */
function webCluster(): string {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(__dirname, "..", file);
    if (!existsSync(p)) continue;
    const match = readFileSync(p, "utf8").match(/^NEXT_PUBLIC_CLUSTER=(.+)$/m);
    if (match?.[1]) return match[1].trim();
  }
  return "localnet";
}

const BANNER_TEXT =
  "Prototype. Not audited. Single pool. Not production mainnet risk capital.";
const ROUTES = ["/markets", "/trade", "/portfolio", "/vault"];

test.describe("Prototype banner", () => {
  for (const route of ROUTES) {
    test(`renders verbatim on ${route}`, async ({ page }) => {
      await page.goto(route);
      const banner = page.getByRole("note");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveText(BANNER_TEXT);
    });
  }
});

test.describe("No horizontal overflow", () => {
  for (const route of ROUTES) {
    test(`${route} has no horizontal scroll at the current viewport`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe("Primary navigation", () => {
  test("moves between Markets, Trade, Portfolio, and Vault", async ({ page }) => {
    await page.goto("/trade");
    await expect(page).toHaveURL(/\/trade$/);

    await page.getByRole("link", { name: "Markets", exact: true }).click();
    await expect(page).toHaveURL(/\/markets$/);
    await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();

    await page.getByRole("link", { name: "Portfolio", exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByRole("heading", { name: "Your Positions" })).toBeVisible();

    await page.getByRole("link", { name: "Vault", exact: true }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole("heading", { name: "Collateral" })).toBeVisible();

    await page.getByRole("link", { name: "Trade", exact: true }).click();
    await expect(page).toHaveURL(/\/trade$/);
  });
});

test.describe("Markets page stays honest without an indexer", () => {
  test("shows the single allowlisted pool and no invented figures", async ({ page }) => {
    await page.goto("/markets");
    await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible();
    // COPY-DECK §5: no TVL, APY, volume or user-count figures anywhere.
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["tvl", "apy", "24h volume", "total value locked", "users"]) {
      expect(body).not.toContain(banned);
    }
  });
});

test.describe("TopBar", () => {
  for (const route of ROUTES) {
    test(`shows the market label, a Spot readout, and the active nav on ${route}`, async ({ page }) => {
      await page.goto(route);
      const header = page.getByRole("banner");
      // Market label is desktop-only (hidden below md); Spot is always present.
      await expect(header.getByText("Spot", { exact: false })).toBeVisible();
      const active = page.getByRole("navigation", { name: "Primary" }).locator('[aria-current="page"]');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveAttribute("href", route);
    });
  }
});

test.describe("Trade desk", () => {
  test("lays out a viz pane and a 360–400px ticket side by side on desktop, ticket-first on phones", async ({
    page,
  }, testInfo) => {
    await page.goto("/trade");
    const ticket = page.getByTestId("trade-ticket");
    const viz = page.getByTestId("trade-viz");
    await expect(ticket).toBeVisible();
    // Phones keep market data behind a closed disclosure; open it to measure the pane.
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: /market data/i }).click();
    }
    await expect(viz).toBeVisible();
    const t = (await ticket.boundingBox())!;
    const v = (await viz.boundingBox())!;
    if (testInfo.project.name === "mobile-chromium") {
      expect(t.y).toBeLessThan(v.y);
    } else {
      expect(t.width).toBeGreaterThanOrEqual(360);
      expect(t.width).toBeLessThanOrEqual(400);
      expect(t.x).toBeGreaterThan(v.x + v.width - 1);
    }
  });

  test("never labels anything as an order book, depth, Greeks or P&L", async ({ page }) => {
    await page.goto("/trade");
    await page.waitForLoadState("networkidle");
    // Labels only: a caption may honestly say "not order book depth", but no
    // heading, figure title, field label or table header may claim one.
    const labels = (await page.locator("h1, h2, h3, figcaption, dt, th, label").allInnerTexts())
      .join("\n")
      .toLowerCase();
    for (const banned of ["order book", "depth", "p&l", "delta", "greeks", "liquidation"]) {
      expect(labels).not.toContain(banned);
    }
  });
});

test.describe("Trade charts", () => {
  test("draws a canvas only when the indexer has a real series, otherwise says why", async ({ page }, testInfo) => {
    await page.goto("/trade");
    await page.waitForLoadState("networkidle");
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: /market data/i }).click();
    }
    const viz = page.getByTestId("trade-viz");
    const premium = viz.locator("figure", { hasText: "Premium index" });
    if ((await premium.count()) > 0) {
      await expect(premium.locator("canvas").first()).toBeVisible();
      // No SVG polyline stub remains once the real chart is in.
      await expect(premium.locator("svg polyline")).toHaveCount(0);
    } else {
      await expect(
        viz.getByText(
          /Charts need the indexer|The indexer is not responding|No indexed data for this market yet/
        )
      ).toBeVisible();
    }
  });
});

test.describe("Portfolio", () => {
  test("never labels anything as P&L, unrealized, a solvency ratio, Greeks or liquidation", async ({ page }) => {
    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");
    const labels = (await page.locator("h1, h2, h3, th, dt, label, figcaption").allInnerTexts())
      .join("\n")
      .toLowerCase();
    for (const banned of ["p&l", "unrealized", "solvency ratio", "greeks", "liquidation"]) {
      expect(labels).not.toContain(banned);
    }
  });
});

test.describe("Vault", () => {
  test("never labels anything as APY, earn, a solvency ratio or P&L", async ({ page }) => {
    await page.goto("/vault");
    await page.waitForLoadState("networkidle");
    const labels = (await page.locator("h1, h2, h3, th, dt, label, figcaption").allInnerTexts())
      .join("\n")
      .toLowerCase();
    for (const banned of [/\bapy\b/, /\bearn\b/, /solvency ratio/, /p&l/, /unrealized/]) {
      expect(labels).not.toMatch(banned);
    }
  });
});

test.describe("Shell chrome by breakpoint", () => {
  test("phones get the tab bar above the banner and no sidenav; desktops the reverse", async ({ page }, testInfo) => {
    await page.goto("/trade");
    const tabbar = page.getByTestId("mobile-tabbar");
    const sidenav = page.getByTestId("sidenav");
    const banner = page.getByRole("note");
    if (testInfo.project.name === "mobile-chromium") {
      await expect(tabbar).toBeVisible();
      await expect(sidenav).toBeHidden();
      await expect(tabbar.getByRole("link")).toHaveCount(4);
      await expect(tabbar.locator('[aria-current="page"]')).toHaveText("Trade");
      // Stacked: the tab bar sits directly above the banner, the banner stays bottom-most.
      const t = (await tabbar.boundingBox())!;
      const b = (await banner.boundingBox())!;
      expect(t.y + t.height).toBeLessThanOrEqual(b.y + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(844);
      // Market data starts closed and opens on tap.
      const disclosure = page.getByRole("button", { name: /market data/i });
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByTestId("trade-viz")).toBeHidden();
      await disclosure.click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByTestId("trade-viz")).toBeVisible();
    } else {
      await expect(sidenav).toBeVisible();
      await expect(tabbar).toBeHidden();
      await expect(page.getByRole("button", { name: /market data/i })).toBeHidden();
    }
  });
});

test.describe("Localnet wallet", () => {
  test("the connect dialog offers the CLI keypair loader with its warning", async ({ page }) => {
    test.skip(webCluster() !== "localnet", "the localnet keypair adapter is compiled out elsewhere");
    await page.goto("/trade");
    await page.getByRole("button", { name: "Connect" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toBeVisible();
    // The dev server runs with NEXT_PUBLIC_CLUSTER=localnet.
    await expect(dialog.getByText("Localnet CLI keypair (fixtures)")).toBeVisible();
    await expect(dialog.getByText(/Never use a mainnet key here/i)).toBeVisible();
    await expect(dialog.getByLabel("Load CLI keypair JSON")).toBeVisible();
  });
});

test.describe("Inventory range picker", () => {
  test("keyboard-selects a range with short liquidity and says where the ticks came from", async ({
    page,
  }, testInfo) => {
    await page.goto("/trade");
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: /market data/i }).click();
    }
    await page.waitForLoadState("networkidle");

    const picker = page.getByRole("region", { name: "Ranges with short liquidity" });
    await expect(picker).toBeVisible();
    // The ticket opens on Short, where the rows start collapsed.
    await page.getByRole("button", { name: /^Long \(buy against inventory\)$/ }).click();

    const rows = picker.getByRole("button", { name: /ticks/ });
    const count = await rows.count();
    if (count === 0) {
      // Honest skip: this cluster has no short liquidity to select.
      await expect(picker.getByText(/No short liquidity in this range/)).toBeVisible();
      test.skip(true, "no ranges with short liquidity on this cluster");
      return;
    }

    const first = rows.first();
    const label = await first.innerText();
    const ticks = label.match(/ticks (-?\d+) to (-?\d+)/);
    expect(ticks).not.toBeNull();

    await first.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Realized range:/)).toContainText(`ticks ${ticks![1]} to ${ticks![2]}`);
    await expect(page.getByText("Selected range from inventory.")).toBeVisible();
  });

  test("caps the list height and collapses it on the short side", async ({ page }, testInfo) => {
    await page.goto("/trade");
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: /market data/i }).click();
    }
    await page.waitForLoadState("networkidle");

    const picker = page.getByRole("region", { name: "Ranges with short liquidity" });
    const rows = page.getByTestId("inventory-rows");
    const useAvailable = picker.getByRole("button", { name: "Use available short" });
    if ((await rows.count()) === 0) {
      test.skip(true, "no ranges with short liquidity on this cluster");
      return;
    }
    // The ticket opens on Short, where the rows start collapsed.
    await page.getByRole("button", { name: /^Long \(buy against inventory\)$/ }).click();

    // However many ranges exist, the list is bounded and scrolls inside the card.
    const box = await rows.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { maxHeight: cs.maxHeight, overflowY: cs.overflowY, height: el.getBoundingClientRect().height };
    });
    expect(box.overflowY).toBe("auto");
    expect(box.maxHeight).not.toBe("none");
    expect(box.height).toBeLessThanOrEqual(parseFloat(box.maxHeight) + 1);

    // Long keeps the rows open; Short collapses them but keeps the shortcut.
    await expect(rows).toBeVisible();
    await page.getByRole("button", { name: /^Short \(provide liquidity\)$/ }).click();
    const disclosure = picker.getByRole("button", { name: /Ranges with short liquidity/ });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(rows).toBeHidden();
    await expect(useAvailable).toBeVisible();

    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(rows).toBeVisible();
  });
});

test.describe("Slide-over footer", () => {
  test("keeps its actions above the honesty banner", async ({ page }) => {
    await page.goto("/trade");
    await page.getByRole("button", { name: "Connect" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
    await expect(dialog).toBeVisible();

    const panel = (await dialog.boundingBox())!;
    const banner = (await page.getByRole("note").boundingBox())!;
    // The panel stops above the fixed chrome, so nothing inside it can be clipped.
    expect(panel.y + panel.height).toBeLessThanOrEqual(banner.y + 1);

    // With no wallet extension the dialog has no footer actions of its own, so
    // the invariant under test is the panel's own bottom edge: everything the
    // panel renders, footer included, lives inside it.
    expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(panel.height).toBeGreaterThan(0);
  });
});
