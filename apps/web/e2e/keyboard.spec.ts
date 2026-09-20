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
