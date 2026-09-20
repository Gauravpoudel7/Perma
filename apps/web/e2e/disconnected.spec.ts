import { test, expect } from "@playwright/test";

/**
 * Wallet stays disconnected for this visual pass (no seed wallet / local
 * validator required). All three routes render identical connect-prompt
 * copy while disconnected — verified against the real page source, not
 * assumed. Vault's "Required free USDC" tile only renders once connected,
 * so it is intentionally not asserted here — see IMPL-UI-PLAYWRIGHT-REPORT.md.
 */
const CONNECT_PROMPT = "Connect a wallet to continue.";

test("Trade: shows connect prompt, no mint action available", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByText(CONNECT_PROMPT)).toBeVisible();
  await expect(page.getByRole("button", { name: /open (short|long)/i })).toHaveCount(0);
});

test("Portfolio: shows connect prompt, no positions table", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Your Positions" })).toBeVisible();
  await expect(page.getByText(CONNECT_PROMPT)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("Vault: shows connect prompt and never mentions a Solvency Ratio", async ({ page }) => {
  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Collateral" })).toBeVisible();
  await expect(page.getByText(CONNECT_PROMPT)).toBeVisible();
  await expect(page.getByText(/solvency ratio/i)).toHaveCount(0);
});
