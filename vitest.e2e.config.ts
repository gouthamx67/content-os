import { defineConfig } from "vitest/config";

/**
 * Browser end-to-end tests. These drive a real Chromium against a running
 * server and a real database, so they are kept out of the default `npm test`
 * run: a unit suite must not depend on a developer's server being up. Run them
 * with `npm run test:e2e` after starting the app.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
