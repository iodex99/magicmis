import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    // WebAssembly and workbook setup in beforeAll can exceed the 10 s default on shared CI runners.
    hookTimeout: 180_000,
  },
});
