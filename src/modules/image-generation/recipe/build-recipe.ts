import {
  buildGenerationContext,
  type GenerationContextDependencies,
  type GenerationContextInput,
} from "../context/build-generation-context";
import type {
  GenerationContext,
  GraphicDesignGraph,
  GraphicTemplateType,
  ImageGenerationProvider,
  ImageOutputFormat,
} from "../domain/types";
import { hashRecipe } from "../serialization/hash-recipe";
import { getGraphicTemplate } from "../templates/registry";
import {
  GENERATION_RECIPE_CONTRACT_VERSION,
  serializeGenerationRecipe,
  type GenerationRecipe,
} from "./generation-recipe";

export type BuildRecipeInput = {
  templateType: GraphicTemplateType;
  provider: ImageGenerationProvider;
  prompt: string;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  context: GenerationContextInput;
  /** When present the document already fixes the artwork and the template is skipped. */
  designGraph?: GraphicDesignGraph;
};

export type BuiltRecipe = {
  recipe: GenerationRecipe;
  recipeJson: string;
  recipeSha256: string;
  context: GenerationContext;
  designGraph: GraphicDesignGraph;
};

/**
 * Builds everything a job needs before any bytes exist: freeze the context, ask
 * the template to draw it, and serialise both into a recipe. The SHA-256 is over
 * the recipe, so it is also the identity used to prove a replay is identical.
 */
export async function buildGenerationRecipe(
  input: BuildRecipeInput,
  deps: GenerationContextDependencies,
): Promise<BuiltRecipe> {
  const context = await buildGenerationContext(input.context, deps);
  const designGraph =
    input.designGraph ??
    getGraphicTemplate(input.templateType).build({
      context,
      width: input.width,
      height: input.height,
      transparent: input.transparent,
    });

  const sourceAssetRefs = Array.from(
    new Set(
      designGraph.elements
        .map((element) => element.assetRef)
        .filter((ref): ref is string => Boolean(ref)),
    ),
  );

  const recipe: GenerationRecipe = {
    contractVersion: GENERATION_RECIPE_CONTRACT_VERSION,
    templateType: input.templateType,
    provider: input.provider,
    width: input.width,
    height: input.height,
    outputFormat: input.outputFormat,
    transparent: input.transparent,
    prompt: input.prompt,
    designGraph,
    context,
    sourceAssetRefs,
  };

  return {
    recipe,
    recipeJson: serializeGenerationRecipe(recipe),
    recipeSha256: hashRecipe(recipe),
    context,
    designGraph,
  };
}
