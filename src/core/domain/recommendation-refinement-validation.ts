import { RecommendationError } from "../../core/domain/content-opportunity";

/**
 * Validation for a model-authored refinement of the deterministic
 * recommendations.
 *
 * A refinement is only ever text over an existing, already-grounded item, so
 * this parser accepts a much smaller shape than the deterministic engine
 * produces: an ordered list of `{ key, title?, rationale?, reasons? }`. It does
 * not accept a score, a subject, evidence, or a new item — a refinement that
 * tried to move any of those would be introducing an ungrounded claim, which is
 * exactly what the deterministic pass exists to prevent.
 *
 * Rewrites name the stable key rather than the row id because the items being
 * refined are freshly generated and have no row ids yet. The key is the one
 * identifier every generated opportunity already carries, and it is what ties a
 * reworded title back to the evidence and subject the engine chose.
 *
 * The service then re-checks the merged result against the full validator and
 * discards the batch unless its size is unchanged, so this module's job is only
 * to refuse a malformed payload early with a clear error instead of letting a
 * half-parsed shape reach the service.
 */

export type RecommendationRewrite = {
  /** Stable key of the opportunity being reworded. */
  key: string;
  title?: string;
  rationale?: string;
  reasons?: string[];
};

const MAX_TITLE_LENGTH = 200;
const MAX_RATIONALE_LENGTH = 600;
const MAX_REASON_LENGTH = 200;
const MAX_REASONS = 8;

function fail(detail: string): never {
  throw new RecommendationError("RECOMMENDATION_INVALID_INPUT", detail);
}

function readText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    return fail(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fail(`${field} must not be empty`);
  }
  if (trimmed.length > limit) {
    return fail(`${field} is longer than ${limit} characters`);
  }
  return trimmed;
}

function readReasons(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    return fail("reasons must be an array of strings");
  }
  if (value.length === 0) {
    return fail("reasons must not be empty when provided");
  }
  if (value.length > MAX_REASONS) {
    return fail(`reasons may contain at most ${MAX_REASONS} entries`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string") {
      return fail("reasons must be an array of strings");
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return fail("reasons entries must not be empty");
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
      return fail(`a reason is longer than ${MAX_REASON_LENGTH} characters`);
    }
    return trimmed;
  });
}

export function parseRecommendationRefinement(raw: unknown): RecommendationRewrite[] {
  // The model may return either the list directly or wrap it, e.g.
  // `{ "recommendations": [...] }`. Both are accepted; anything else is not.
  const candidate =
    Array.isArray(raw)
      ? raw
      : typeof raw === "object" && raw !== null
        ? (raw as { recommendations?: unknown }).recommendations
        : undefined;

  if (!Array.isArray(candidate)) {
    return fail("Refinement must be an array of rewrites");
  }

  const seen = new Set<string>();

  return candidate.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail("each rewrite must be an object");
    }
    const record = entry as Record<string, unknown>;

    const key = record["key"];
    if (typeof key !== "string" || key.trim().length === 0) {
      return fail("each rewrite must carry a non-empty key");
    }

    const allowed = new Set(["key", "title", "rationale", "reasons"]);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        return fail(
          `refinement may not change "${key}"; a refinement may only reword or reorder`,
        );
      }
    }

    // A list that quietly lost an entry would still pass the grounding
    // validator while dropping a recommendation the user was owed, and one that
    // repeats an entry would pass the size check while applying a rewrite twice.
    // Both are refused here, where the mistake is still visible.
    const trimmedKey = key.trim();
    if (seen.has(trimmedKey)) {
      return fail(`refinement names recommendation ${trimmedKey} more than once`);
    }
    seen.add(trimmedKey);

    return {
      key: trimmedKey,
      title: readText(record["title"], "title", MAX_TITLE_LENGTH),
      rationale: readText(record["rationale"], "rationale", MAX_RATIONALE_LENGTH),
      reasons: readReasons(record["reasons"]),
    };
  });
}