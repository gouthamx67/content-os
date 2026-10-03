import type {
  GenerationBrandContext,
  GenerationContext,
  GenerationProductContext,
} from "../domain/types";

export type IntentSnapshot = {
  id: string;
  channel: string | null;
  contentType: string | null;
  tone: string | null;
  audience: string | null;
  rawRequest: string | null;
};

export type DirectionSnapshot = {
  id: string;
  thesis: string | null;
  visualStyle: string | null;
  voice: string | null;
};

export type SceneSnapshot = {
  storyboardId: string;
  sceneId: string;
  text: string | null;
  visualType: string | null;
};

export type GenerationContextInput = {
  projectId: string;
  userRequest: string;
  intentId?: string | null;
  directionId?: string | null;
  storyboardId?: string | null;
  sceneId?: string | null;
};

export type GenerationContextDependencies = {
  loadProduct(projectId: string): Promise<GenerationProductContext>;
  loadBrand(projectId: string): Promise<GenerationBrandContext>;
  loadIntent(
    projectId: string,
    intentId: string | null,
  ): Promise<IntentSnapshot | null>;
  loadDirection(
    projectId: string,
    directionId: string | null,
  ): Promise<DirectionSnapshot | null>;
  loadScene(
    projectId: string,
    storyboardId: string | null,
    sceneId: string | null,
  ): Promise<SceneSnapshot | null>;
  loadIntelligenceVersion(projectId: string): Promise<number | null>;
  listSourceAssetIds(projectId: string): Promise<string[]>;
};

/**
 * Reads the project's real CP06/CP08/CP09/CP10/CP11 state once and freezes it.
 * The returned snapshot is serialised into the recipe, so the job can be
 * replayed byte-for-byte even after the project has moved on.
 */
export async function buildGenerationContext(
  input: GenerationContextInput,
  deps: GenerationContextDependencies,
): Promise<GenerationContext> {
  const [product, brand, intent, direction, scene, intelligenceVersion, sourceAssetIds] =
    await Promise.all([
      deps.loadProduct(input.projectId),
      deps.loadBrand(input.projectId),
      deps.loadIntent(input.projectId, input.intentId ?? null),
      deps.loadDirection(input.projectId, input.directionId ?? null),
      deps.loadScene(
        input.projectId,
        input.storyboardId ?? null,
        input.sceneId ?? null,
      ),
      deps.loadIntelligenceVersion(input.projectId),
      deps.listSourceAssetIds(input.projectId),
    ]);

  return {
    projectId: input.projectId,
    product,
    brand,
    intentId: intent?.id ?? null,
    intentChannel: intent?.channel ?? null,
    intentContentType: intent?.contentType ?? null,
    intentTone: intent?.tone ?? null,
    intentAudience: intent?.audience ?? null,
    intentRawRequest: intent?.rawRequest ?? null,
    directionId: direction?.id ?? null,
    directionThesis: direction?.thesis ?? null,
    directionVisualStyle: direction?.visualStyle ?? null,
    directionVoice: direction?.voice ?? null,
    storyboardId: scene?.storyboardId ?? null,
    sceneId: scene?.sceneId ?? null,
    sceneText: scene?.text ?? null,
    sceneVisualType: scene?.visualType ?? null,
    sourceAssetIds,
    brandVersion: brand.version,
    intelligenceVersion,
    userRequest: input.userRequest,
  };
}
