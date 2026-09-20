import { test, expect } from "@playwright/test";

const BANNER_TEXT =
  "Prototype. Not audited. Single pool. Not production mainnet risk capital.";
const ROUTES = ["/trade", "/portfolio", "/vault"];

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
  test("moves between Trade, Portfolio, and Vault", async ({ page }) => {
    await page.goto("/trade");
    await expect(page).toHaveURL(/\/trade$/);

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
