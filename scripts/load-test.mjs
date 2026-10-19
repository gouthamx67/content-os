#!/usr/bin/env node
//
// Bounded load test.
//
// The goal is a repeatable smoke of read-path latency under concurrency, not a
// benchmark rig. It registers one throwaway user, then issues a fixed, capped
// number of requests across a mixed workload and reports latency percentiles
// and the error rate. The cap keeps it safe to run against a developer's own
// server without becoming a denial-of-service tool.
//
// Usage:
//   node scripts/load-test.mjs [--base http://localhost:3000] [--requests 300] [--concurrency 8]
//
// Exit code is non-zero if any request errored or the p95 exceeded the budget,
// so CI/ops can gate on it.

const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value === undefined ? fallback : value;
}

const BASE_URL = argValue("--base", "http://localhost:3000").replace(/\/$/, "");
const TOTAL = Math.min(Number(argValue("--requests", "300")), 500);
const CONCURRENCY = Math.max(1, Math.min(Number(argValue("--concurrency", "8")), 16));
const P95_BUDGET_MS = Number(argValue("--p95-budget-ms", "1500"));

async function registerUser() {
  const email = `loadtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "load-test-password" }),
  });
  if (!response.ok) {
    throw new Error(`register failed: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("register returned no session cookie");
  return cookie.split(";")[0];
}

async function timed(name, request) {
  const start = performance.now();
  let status = 0;
  let ok = false;
  try {
    const response = await request();
    status = response.status;
    ok = response.ok;
    await response.arrayBuffer();
  } catch (error) {
    ok = false;
    status = -1;
    void error;
  }
  return { name, ok, status, ms: performance.now() - start };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

async function main() {
  console.log(`load-test: ${TOTAL} requests, concurrency ${CONCURRENCY}, base ${BASE_URL}`);
  const cookie = await registerUser();

  const headers = { cookie };
  const workload = [
    () => timed("health", () => fetch(`${BASE_URL}/api/health`)),
    () => timed("projects", () => fetch(`${BASE_URL}/api/projects`, { headers })),
    () => timed("workspaces", () => fetch(`${BASE_URL}/api/workspaces`, { headers })),
  ];

  const results = [];
  let issued = 0;
  let cursor = 0;

  async function worker() {
    while (issued < TOTAL) {
      issued += 1;
      const task = workload[cursor % workload.length];
      cursor += 1;
      results.push(await task());
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const totalMs = performance.now() - startedAt;

  const latencies = results.map((result) => result.ms).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  const byName = new Map();
  for (const result of results) {
    const entry = byName.get(result.name) ?? { count: 0, failures: 0, total: 0 };
    entry.count += 1;
    entry.total += result.ms;
    if (!result.ok) entry.failures += 1;
    byName.set(result.name, entry);
  }

  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const throughput = (results.length / totalMs) * 1000;

  for (const [name, entry] of byName) {
    console.log(
      `load-test: ${name.padEnd(12)} count=${entry.count} failures=${entry.failures} avg=${(entry.total / entry.count).toFixed(1)}ms`,
    );
  }
  console.log(
    `load-test: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms throughput=${throughput.toFixed(1)} req/s`,
  );
  console.log(`load-test: failures=${failures.length}/${results.length}`);

  const failureStatuses = [...new Set(failures.map((f) => f.status))];
  if (failures.length > 0) {
    console.error(`load-test: FAIL non-2xx statuses: ${failureStatuses.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (p95 > P95_BUDGET_MS) {
    console.error(`load-test: FAIL p95 ${p95.toFixed(1)}ms exceeds budget ${P95_BUDGET_MS}ms`);
    process.exitCode = 1;
    return;
  }
  console.log("load-test: PASS");
}

main().catch((error) => {
  console.error("load-test: crashed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
