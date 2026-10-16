import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

/**
 * Canonical JSON for everything a localization job stores as text.
 *
 * A value that is hashed must have exactly one representation, so the same
 * source text localized twice — or the same segment list rebuilt in a different
 * order — produces the same bytes and the same digest.
 */
export function serializeLocalizationJson(value: unknown): string {
  return stableStringify(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function localizationHash(value: unknown): string {
  return sha256Hex(serializeLocalizationJson(value));
}

/**
 * Parses a stored JSON column and refuses to repair it. A value that does not
 * parse is a corrupted row, and rewriting it would discard the only record of
 * what the job actually held.
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
