import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

/**
 * Canonical JSON for everything a campaign stores as text.
 *
 * The same reasoning as CP19's source snapshot and CP20's editor snapshot: a
 * value that is hashed must have exactly one representation, so two campaigns
 * built from the same inputs in a different order produce the same bytes and the
 * same digest.
 */
export function serializeCampaignJson(value: unknown): string {
  return stableStringify(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function campaignHash(value: unknown): string {
  return sha256Hex(serializeCampaignJson(value));
}

/**
 * Parses a stored JSON column and refuses to repair it. A value that does not
 * parse is a corrupted row, and rewriting it would discard the only record of
 * what the campaign actually held.
 */
export function parseStoredJson<T>(serialized: string, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`Stored ${label} is not valid JSON`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stored ${label} is not an object`);
  }

  return parsed as T;
}
