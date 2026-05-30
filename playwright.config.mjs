import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry"
  },
  webServer: {
    command: "node scripts/serve-dist.mjs 4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:4174"
  }
});
