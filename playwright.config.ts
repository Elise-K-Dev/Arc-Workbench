import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:1420",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --force",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
  },
});
