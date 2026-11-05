import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { getE2EDatabaseUrl } from "./tests/e2e/database-url";

const baseURL = "http://127.0.0.1:3100";
const databaseUrl = getE2EDatabaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_APP_URL: baseURL,
      AUTH_SECRET: "playwright-only-secret-not-for-production-use",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
