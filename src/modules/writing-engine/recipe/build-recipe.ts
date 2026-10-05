import type {
  WritingContext,
  WritingGenerateRequest,
  WritingRecipe,
} from "../domain/types";
import {
  serializeWritingRecipe,
  writingRecipeSha256,
} from "./snapshot";

export type BuiltWritingRecipe = {
  recipe: WritingRecipe;
  recipeSha256: string;
  serialized: string;
};

/**
 * Freezes a request plus its context into the recipe a job will run.
 *
 * The context is embedded and hashed as one document: there is no `PATCH` for a
 * recipe, so once a job is queued the recipe cannot be edited underneath it.
 */
export function buildWritingRecipe(
  request: WritingGenerateRequest,
  context: WritingContext,
): BuiltWritingRecipe {
  const recipe: WritingRecipe = {
    version: 1,
    projectId: request.projectId,
    blockType: request.blockType,
    tone: request.tone,
    length: request.length,
    objective: request.objective,
    audience: request.audience,
    language: request.language,
    prompt: request.prompt,
    variantCount: request.variantCount,
    provider: request.provider,
    context,
  };

  return {
    recipe,
    recipeSha256: writingRecipeSha256(recipe),
    serialized: serializeWritingRecipe(recipe),
  };
}
