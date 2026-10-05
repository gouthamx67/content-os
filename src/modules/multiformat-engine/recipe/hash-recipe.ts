import { hashAdaptation } from "../serialization/hash-adaptation";
import type { AdaptationRecipe } from "../domain/types";

/**
 * The digest of a persisted recipe, computed the one way.
 *
 * A retry is "the same work" exactly when this returns the value already stored
 * on the job, so both the writer and any later comparison go through here rather
 * than re-serialising the recipe themselves.
 */
export function hashRecipe(recipe: AdaptationRecipe): string {
  return hashAdaptation(recipe);
}

export function parseRecipe(serialized: string): AdaptationRecipe {
  const parsed: unknown = JSON.parse(serialized);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as AdaptationRecipe).formatId !== "string"
  ) {
    throw new Error("Malformed adaptation recipe");
  }

  return parsed as AdaptationRecipe;
}