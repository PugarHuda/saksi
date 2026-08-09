import { defineConfig } from "@playwright/test";

/** One browser, one width, one spec. The console reads Monad live, so the whole point of
 *  this suite is that it runs against a real server and a real chain — mocking the RPC would
 *  only test that the mock still matches itself.
 *
 *  ponytail: no fixtures, no projects, no reporters. Add a second width when a second width
 *  actually breaks. */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
  },
  // Skipped when BASE_URL points somewhere already running (a preview or production URL).
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run build && npx next start -p 3100",
        url: "http://localhost:3100/console",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
