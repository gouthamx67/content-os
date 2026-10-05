import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

/**
 * An adaptation digest is a property of the value, not of the order its keys
 * were assembled, and not of which job happened to request it. That is what
 * makes the same source adapted to the same format produce the same hash twice,
 * so a retry is recognisable as the same work instead of a fresh guess.
 */
export function hashAdaptation(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : value)
    .digest("hex");
}