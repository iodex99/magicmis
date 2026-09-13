import { defineConfig } from "vitest/config";

// Unit tests only. e2e/ belongs to Playwright (`pnpm e2e`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
