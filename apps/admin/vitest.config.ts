import { defineConfig } from "vitest/config";

// Server modules only; the Next.js pages are exercised through them.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["../../packages/db/test/setup-docker-path.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
