import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicOrm } from "../prisma/db";
import type { RateLimitPolicy } from "./rate-limit";

const TEST_DATABASE_URL =
  "postgresql://contentos:contentos@localhost:5433/content_os_test";

let orm: PublicOrm;
let consumeRateLimit: typeof import("./rate-limit").consumeRateLimit;
let enforceRateLimit: typeof import("./rate-limit").enforceRateLimit;
let clientIdentity: typeof import("./rate-limit").clientIdentity;

const usedIdentities: string[] = [];

function testPolicy(limit: number): RateLimitPolicy {
  return { name: `itest_${randomUUID().slice(0, 8)}`, limit, windowMs: 60_000 };
}

function identity(): string {
  const id = `itest-identity-${randomUUID()}`;
  usedIdentities.push(id);
  return id;
}

beforeAll(async () => {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;
  const [{ db }, rateLimit] = await Promise.all([
    import("../prisma/db"),
    import("./rate-limit"),
  ]);
  orm = db.orm.public;
  consumeRateLimit = rateLimit.consumeRateLimit;
  enforceRateLimit = rateLimit.enforceRateLimit;
  clientIdentity = rateLimit.clientIdentity;
});

afterAll(async () => {
  if (usedIdentities.length === 0) return;
  const rows = await orm.RateLimitEvent.all();
  for (const row of rows) {
    if (usedIdentities.some((id) => row.bucketKey.includes(id))) {
      await orm.RateLimitEvent.where({ id: row.id })
        .delete()
        .catch(() => undefined);
    }
  }
});

describe("rate limiting", () => {
  it("allows up to the limit and rejects the next request", async () => {
    const policy = testPolicy(3);
    const key = identity();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(consumeRateLimit(policy, key)).resolves.toEqual({
        allowed: true,
      });
    }

    const rejected = await consumeRateLimit(policy, key);
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("keeps separate buckets per identity", async () => {
    const policy = testPolicy(1);

    await expect(consumeRateLimit(policy, identity())).resolves.toEqual({
      allowed: true,
    });
    await expect(consumeRateLimit(policy, identity())).resolves.toEqual({
      allowed: true,
    });
  });

  it("returns a 429 with Retry-After when enforced", async () => {
    const policy = testPolicy(1);
    const key = identity();

    expect(await enforceRateLimit(policy, key)).toBeNull();

    const response = await enforceRateLimit(policy, key);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get("Retry-After")).toBeTruthy();

    const body = (await response!.json()) as {
      error: string;
      code: string;
      retryAfterSeconds: number;
    };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("clientIdentity", () => {
  it("ignores a spoofable forwarded header without a trusted proxy", () => {
    const previous = process.env["CONTENT_OS_TRUST_PROXY"];
    delete process.env["CONTENT_OS_TRUST_PROXY"];
    try {
      const request = new Request("http://localhost/", {
        headers: { "x-forwarded-for": "203.0.113.9" },
      });
      expect(clientIdentity(request)).toBe("direct");
    } finally {
      if (previous !== undefined) {
        process.env["CONTENT_OS_TRUST_PROXY"] = previous;
      }
    }
  });

  it("uses the first forwarded address behind a trusted proxy", () => {
    const previous = process.env["CONTENT_OS_TRUST_PROXY"];
    process.env["CONTENT_OS_TRUST_PROXY"] = "1";
    try {
      const request = new Request("http://localhost/", {
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      });
      expect(clientIdentity(request)).toBe("203.0.113.9");
    } finally {
      if (previous === undefined) {
        delete process.env["CONTENT_OS_TRUST_PROXY"];
      } else {
        process.env["CONTENT_OS_TRUST_PROXY"] = previous;
      }
    }
  });
});
