import { db } from "../prisma/db";
import { createId } from "./id";
import { jsonError } from "./http";
import { logEvent, sanitizeError } from "./observability";

/**
 * Fixed-window rate limiting backed by Postgres.
 *
 * A shared store is required because the deployment runs several processes
 * (web + workers) and an in-memory counter would enforce nothing across them.
 * Each request writes its own event row first and then counts the window, so
 * a rejected attempt still consumes the window: hammering cannot outrun the
 * limiter by racing concurrent requests. Counting committed rows can overshoot
 * the cap by at most the number of truly simultaneous requests in flight,
 * which is the standard fixed-window approximation and is documented in the
 * runbook.
 *
 * If the store itself is unavailable the limiter logs and lets the request
 * proceed: a database outage is already visible through readiness, and
 * failing every route because the limiter cannot count would turn a
 * degradation into an outage.
 */

export type RateLimitPolicy = {
  name: string;
  limit: number;
  windowMs: number;
};

const MINUTE = 60_000;

export const RATE_LIMITS = {
  authLogin: { name: "auth_login", limit: 10, windowMs: 5 * MINUTE },
  authRegister: { name: "auth_register", limit: 5, windowMs: 60 * MINUTE },
  aiGeneration: { name: "ai_generation", limit: 30, windowMs: MINUTE },
  sourceIngestion: { name: "source_ingestion", limit: 30, windowMs: MINUTE },
  browserRun: { name: "browser_run", limit: 10, windowMs: MINUTE },
  renderDispatch: { name: "render_dispatch", limit: 30, windowMs: MINUTE },
  captureUpload: { name: "capture_upload", limit: 20, windowMs: MINUTE },
  localizationProcess: { name: "localization_process", limit: 20, windowMs: MINUTE },
  publishingMutation: { name: "publishing_mutation", limit: 120, windowMs: MINUTE },
  analyticsRefresh: { name: "analytics_refresh", limit: 60, windowMs: MINUTE },
  healthProbe: { name: "health_probe", limit: 120, windowMs: MINUTE },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMITS;

/**
 * The identity used for unauthenticated limits. Forwarded addresses are
 * spoofable, so they are trusted only when the deployment explicitly declares
 * a trusted proxy. Without one, all unauthenticated traffic shares the
 * `direct` bucket, which is a real limit but cannot be per-client; the runbook
 * documents that per-IP limiting requires CONTENT_OS_TRUST_PROXY=1 behind a
 * proxy that overwrites the header.
 */
export function clientIdentity(request: Request): string {
  if (process.env["CONTENT_OS_TRUST_PROXY"] === "1") {
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "direct";
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function consumeRateLimit(
  policy: RateLimitPolicy,
  identity: string,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowStartMs = Math.floor(now / policy.windowMs) * policy.windowMs;
  const bucketKey = `${policy.name}:${identity}:${windowStartMs}`;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStartMs + policy.windowMs - now) / 1000),
  );

  try {
    const orm = db.orm.public;
    await orm.RateLimitEvent.create({
      id: createId("rle"),
      bucketKey,
    });
    const totals = await orm.RateLimitEvent.where({ bucketKey }).aggregate(
      (aggregate) => ({ total: aggregate.count() }),
    );
    if (totals.total > policy.limit) {
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true };
  } catch (error) {
    logEvent("warn", "rate_limit.store_failed", {
      policy: policy.name,
      error: sanitizeError(error),
    });
    return { allowed: true };
  }
}

/**
 * Route-level helper. Returns a ready 429 response when the limit is
 * exceeded, or null when the request may proceed.
 *
 * `identity` should be the authenticated user id when one exists, otherwise
 * an email (for credential endpoints) or the client identity; callers can
 * append a scope segment so one endpoint's traffic cannot exhaust another's.
 */
export async function enforceRateLimit(
  policy: RateLimitPolicy,
  identity: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit(policy, identity);
  if (decision.allowed) return null;

  const response = jsonError(429, "Too many requests", {
    code: "RATE_LIMITED",
    retryAfterSeconds: decision.retryAfterSeconds,
  });
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return response;
}
