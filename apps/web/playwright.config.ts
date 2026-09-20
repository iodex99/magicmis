import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real Supabase local stack (`npx supabase start`) and a production build
 * of the app. Nothing is mocked: auth, email (via Mailpit) and Postgres are all real.
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
  // Under CI, failures are also written as annotations, which the public checks API serves
  // without a token: a failed run can be read, not guessed at (CLAUDE.md, "read the log").
  reporter: process.env["CI"] ? [["list"], ["github"]] : [["list"]],
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
      // One Node process serves every request here, unlike Vercel where each warm instance
      // has its own pool. A 50 MB upload sends its chunks at once, so the serverless default
      // of a few connections queues them behind each other (ADR 0054).
      DATABASE_POOL_MAX: "12",
      KEY_WRAPPER: "local",
      LOCAL_MASTER_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString(
        "base64",
      ),
      OUTPUT_STORE: "local",
      // Chat E2E drives a deterministic fake model; refused outside development (lib/server/ai.ts).
      AI_TRANSPORT: "fake",
      // ADR 0043: Google on and Apple off, so both branches of the provider gate are driven.
      // No credentials exist locally; the tests stop at the redirect to the identity service.
      AUTH_OAUTH_PROVIDERS: "google",
    },
    timeout: 120_000,
  },
});
