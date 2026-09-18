import { defineConfig, devices } from "@playwright/test";

/** Admin E2E against the local Supabase Postgres and a production build (port 3001). */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // Under CI, failures are also written as annotations, which the public checks API serves
  // without a token: a failed run can be read, not guessed at (CLAUDE.md, "read the log").
  reporter: process.env["CI"] ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3001/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
