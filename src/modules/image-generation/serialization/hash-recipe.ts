import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";

/**
 * The recipe digest is a property of the recipe, not of the order its keys were
 * assembled. Sorting keys first is what makes two equal recipes hash equal, and
 * therefore what makes a replay deterministic.
 */
export function hashRecipe(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
