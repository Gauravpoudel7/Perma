import { test, expect } from "@playwright/test";
import path from "node:path";

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "..", "docs", "04-ui-ux", "screenshots");

test("Tab reaches the Connect button and shows a visible focus ring", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop-webkit", "chromium-only screenshot set");
  await page.goto("/trade");

  const connectButton = page.getByRole("button", { name: "Connect" });
  await expect(connectButton).toBeVisible();

  // Real keyboard traversal, not .focus() — this is what a keyboard-only
  // user actually experiences: Sidenav (Trade/Portfolio/Vault/Docs) then
  // the TopBar's Connect button.
  let reached = false;
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const isConnectFocused = await connectButton.evaluate(
      (el) => el === document.activeElement
    );
    if (isConnectFocused) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  const outlineStyle = await connectButton.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outlineStyle).not.toBe("none");

  const isMobile = testInfo.project.name === "mobile-chromium";
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `focus-ring-${isMobile ? "mobile" : "desktop"}.png`),
  });
});

test("Skip link is the first Tab stop and moves focus to main", async ({ page }, testInfo) => {
  // WebKit does not Tab onto links unless the OS "press Tab to highlight each item" setting is on.
  test.skip(testInfo.project.name === "desktop-webkit", "chromium-only keyboard set");
  await page.goto("/trade");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("Connect dialog traps focus, closes on Escape, and returns focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop-webkit", "chromium-only keyboard set");
  await page.goto("/trade");
  const connect = page.getByRole("button", { name: "Connect" });
  await connect.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(dialog).toBeVisible();
  // With no wallet extension and no localnet keypair entry the dialog has
  // nothing focusable, so there is no trap to exercise.
  const focusable = await dialog.locator("button, a[href], input").count();
  test.skip(focusable === 0, "no focusable controls in the dialog on this cluster");
  // Initial focus lands inside; Tab never escapes the dialog.
  for (let i = 0; i < 6; i++) {
    const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(inside).toBe(true);
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(connect).toBeFocused();
});

test("Mobile: tab bar links and the market-data disclosure are keyboard reachable with visible rings", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "phone chrome only");
  await page.goto("/trade");
  const disclosure = page.getByRole("button", { name: /market data/i });
  await disclosure.focus();
  expect(await disclosure.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  const tab = page.getByTestId("mobile-tabbar").getByRole("link", { name: "Portfolio" });
  await tab.focus();
  await expect(tab).toBeFocused();
  expect(await tab.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
});
