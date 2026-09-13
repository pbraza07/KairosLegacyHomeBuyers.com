import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: "http://localhost:3000", headless: true },
  webServer: {
    command: "node --import tsx scripts/test-server.ts",
    url: "http://localhost:3000/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
