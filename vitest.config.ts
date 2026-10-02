import { defineConfig } from "vitest/config";

/**
 * Server-side suites (domain, services, real Chromium runtime, Postgres
 * integration) run in Node. Component suites opt into jsdom with a
 * `@vitest-environment jsdom` docblock so the panel test does not drag a DOM
 * into the rest of the suite.
 *
 * Postgres suites share one database and truncate it in `beforeAll`. Run in
 * parallel, one suite's cleanup deletes another's rows mid-assertion, which
 * surfaces as a random failure in an unrelated test. File parallelism is off so
 * the database is only ever owned by one suite at a time.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
