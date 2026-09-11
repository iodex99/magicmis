import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Must run before any testcontainers import: it repairs PATH so the Docker
    // credential helper is spawnable. See the file for why.
    setupFiles: ["./test/setup-docker-path.ts"],
    // Containers take time to start; each suite boots its own Postgres.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One container per file, files in sequence: parallel Postgres containers on a
    // laptop contend for memory and make failures look flaky.
    fileParallelism: false,
  },
});
