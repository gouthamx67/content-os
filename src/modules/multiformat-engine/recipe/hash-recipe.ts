import { hashAdaptation } from "../serialization/hash-adaptation";
import { RECIPE_VERSION } from "./build-recipe";
import { AdaptationError } from "../errors";
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

function malformed(reason: string): AdaptationError {
  return new AdaptationError("ADAPTATION_RECIPE_MALFORMED", `Malformed adaptation recipe: ${reason}`, 500);
}

/**
 * Reads back a persisted recipe, refusing anything this build cannot execute.
 *
 * The stored digest alone is not enough of a guard. A recipe written by a later
 * version of the engine still carries a self-consistent digest, and an older
 * worker that parsed it would happily produce the wrong shape. So the version is
 * checked here, and the fields every adapter reads are checked for the shape
 * each adapter assumes.
 */
export function parseRecipe(serialized: string): AdaptationRecipe {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw malformed("not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw malformed("not an object");
  }

  const recipe = parsed as Partial<AdaptationRecipe>;

  if (recipe.recipeVersion !== RECIPE_VERSION) {
    throw malformed(
      `unsupported recipe version ${String(recipe.recipeVersion)} (this build runs ${RECIPE_VERSION})`,
    );
  }

  if (typeof recipe.formatId !== "string" || typeof recipe.kind !== "string") {
    throw malformed("missing format identity");
  }

  if (
    recipe.platformId !== null &&
    typeof recipe.platformId !== "string"
  ) {
    throw malformed("platform must be a string or null");
  }

  if (
    typeof recipe.sourceType !== "string" ||
    typeof recipe.sourceId !== "string" ||
    !/^[0-9a-f]{64}$/.test(recipe.sourceSha256 ?? "")
  ) {
    throw malformed("source identity is incomplete");
  }

  if (!recipe.output || typeof recipe.output !== "object") {
    throw malformed("missing output contract");
  }

  const output = recipe.output as Partial<AdaptationRecipe["output"]>;

  if (typeof output.mimeType !== "string") {
    throw malformed("output is missing its mime type");
  }

  for (const key of ["width", "height", "maxCharacters", "maxWords"] as const) {
    const value = output[key];

    if (value !== null && typeof value !== "number") {
      throw malformed(`output.${key} must be a number or null`);
    }
  }

  for (const key of ["fit", "position"] as const) {
    const value = output[key];

    if (value !== null && typeof value !== "string") {
      throw malformed(`output.${key} must be a string or null`);
    }
  }

  if (
    !Array.isArray(recipe.provenanceSourceIds) ||
    recipe.provenanceSourceIds.some((id) => typeof id !== "string")
  ) {
    throw malformed("provenance must be a list of source ids");
  }

  if (
    recipe.outputStorageKey !== null &&
    typeof recipe.outputStorageKey !== "string"
  ) {
    throw malformed("output storage key must be a string or null");
  }

  return recipe as AdaptationRecipe;
}
