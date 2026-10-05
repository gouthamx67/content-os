import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

/**
 * A writing digest is a property of the value, not of the order its keys were
 * assembled. Sorting keys first is what makes the recipe, context and content
 * hashes reproducible across a replay.
 */
export function hashWriting(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** The digest of a plain string, used for `textSha256` and `contentSha256`. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
