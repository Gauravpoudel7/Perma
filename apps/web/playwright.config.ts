import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Visual/e2e QA for the disconnected-wallet UI (Trade/Portfolio/Vault).
 * Port defaults to 3001 because 3000 is routinely occupied by another
 * local process on this machine — see IMPL-UI-PLAYWRIGHT-REPORT.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    cwd: __dirname,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
