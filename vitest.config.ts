import { defineConfig } from "vitest/config";

/**
 * Server-side suites (domain, services, real Chromium runtime, Postgres
 * integration) run in Node. Component suites opt into jsdom with a
 * `@vitest-environment jsdom` docblock so the panel test does not drag a DOM
 * into the rest of the suite.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
