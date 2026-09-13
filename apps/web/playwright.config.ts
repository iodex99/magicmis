import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real Supabase local stack (`npx supabase start`) and a production build
 * of the app. Nothing is mocked: auth, email (via Mailpit), TOTP and Postgres are real.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/fixtures-setup.ts",
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
    // Company memory in local runs: the local key wrapper and file output store are accepted only
    // in development (the local Supabase stack runs without Storage). A fixed, test-only key.
    env: {
      KEY_WRAPPER: "local",
      LOCAL_MASTER_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
      OUTPUT_STORE: "local",
    },
    timeout: 120_000,
  },
});
