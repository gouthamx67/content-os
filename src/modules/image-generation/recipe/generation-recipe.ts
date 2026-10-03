import {
  GRAPHIC_TEMPLATE_TYPES,
  IMAGE_GENERATION_PROVIDERS,
  IMAGE_OUTPUT_FORMATS,
  type GraphicDesignGraph,
  type GraphicTemplateType,
  type GenerationContext,
  type ImageGenerationProvider,
  type ImageOutputFormat,
} from "../domain/types";
import { ImageGenerationError } from "../errors";

export const GENERATION_RECIPE_CONTRACT_VERSION = 1;

/**
 * The recipe is the job's entire input, frozen. It holds the design graph and
 * the context snapshot it was built from, so replaying the job needs nothing
 * from the live project and two runs of the same recipe must produce the same
 * bytes.
 */
export type GenerationRecipe = {
  contractVersion: 1;
  templateType: GraphicTemplateType;
  provider: ImageGenerationProvider;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  prompt: string;
  designGraph: GraphicDesignGraph;
  context: GenerationContext;
  sourceAssetRefs: string[];
};

export function serializeGenerationRecipe(recipe: GenerationRecipe): string {
  return JSON.stringify(recipe);
}

export function parseGenerationRecipe(json: string): GenerationRecipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalid("Generation recipe is not valid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { contractVersion?: unknown }).contractVersion !==
      GENERATION_RECIPE_CONTRACT_VERSION
  ) {
    throw invalid("Unsupported generation recipe contract version");
  }

  const recipe = parsed as GenerationRecipe;
  if (!GRAPHIC_TEMPLATE_TYPES.includes(recipe.templateType)) {
    throw invalid("Generation recipe has an unknown template type");
  }
  if (!IMAGE_GENERATION_PROVIDERS.includes(recipe.provider)) {
    throw invalid("Generation recipe has an unknown provider");
  }
  if (!IMAGE_OUTPUT_FORMATS.includes(recipe.outputFormat)) {
    throw invalid("Generation recipe has an unknown output format");
  }
  if (
    typeof recipe.designGraph !== "object" ||
    recipe.designGraph === null ||
    !Array.isArray(recipe.designGraph.elements)
  ) {
    throw invalid("Generation recipe is missing a design graph");
  }

  return recipe;
}

function invalid(message: string): ImageGenerationError {
  return new ImageGenerationError("IMAGE_INVALID_REQUEST", message, 422);
}
