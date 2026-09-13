import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real Supabase local stack (`npx supabase start`) and a production build
 * of the app. Nothing is mocked: auth, email (via Mailpit), TOTP and Postgres are real.
 */
export default defineConfig({
  testDir: "./e2e",
  // Flows share one Auth server and one Mailpit inbox; run them one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
