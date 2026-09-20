import { test } from "@playwright/test";
import path from "node:path";

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "..", "docs", "04-ui-ux", "screenshots");

const ROUTES: Array<{ path: string; name: string }> = [
  { path: "/trade", name: "trade" },
  { path: "/portfolio", name: "portfolio" },
  { path: "/vault", name: "vault" },
];

for (const route of ROUTES) {
  test(`screenshot ${route.name}`, async ({ page }, testInfo) => {
    // The canonical 6 filenames are Chromium-only; desktop-webkit is a
    // bonus cross-engine correctness check (see other specs), not a
    // second desktop screenshot writing to the same path.
    test.skip(testInfo.project.name === "desktop-webkit", "chromium-only screenshot set");
    await page.goto(route.path);
    await page.waitForLoadState("networkidle");
    const viewportLabel = testInfo.project.name === "mobile-chromium" ? "mobile" : "desktop";
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${route.name}-${viewportLabel}.png`),
      fullPage: true,
    });
  });
}
