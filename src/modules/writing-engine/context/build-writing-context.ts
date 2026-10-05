import type {
  WritingBlockType,
  WritingBrandContext,
  WritingContext,
  WritingDirectionContext,
  WritingIntentContext,
  WritingLength,
  WritingObjective,
  WritingProductContext,
  WritingSceneContext,
  WritingTone,
} from "../domain/types";
import { collectSourceIds, buildFacts } from "./context-facts";
import { resolveAudience } from "./audience";

export type WritingContextInput = {
  projectId: string;
  blockType: WritingBlockType;
  tone: WritingTone;
  length: WritingLength;
  objective: WritingObjective;
  audience: string | null;
  language: string | null;
  userRequest: string;
  intentId: string | null;
  directionId: string | null;
  storyboardId: string | null;
  sceneId: string | null;
};

export type WritingContextDependencies = {
  loadProduct(projectId: string): Promise<WritingProductContext>;
  loadBrand(projectId: string): Promise<WritingBrandContext>;
  loadIntent(
    projectId: string,
    intentId: string | null,
  ): Promise<WritingIntentContext | null>;
  loadDirection(
    projectId: string,
    directionId: string | null,
  ): Promise<WritingDirectionContext | null>;
  loadScene(
    projectId: string,
    storyboardId: string | null,
    sceneId: string | null,
  ): Promise<WritingSceneContext | null>;
  listKnownSourceIds(projectId: string): Promise<string[]>;
  loadIntelligenceVersion(projectId: string): Promise<number | null>;
};

/**
 * Reads the real CP06/CP08/CP09/CP10/CP11 state once and freezes it.
 *
 * The result is serialised into the job's `contextSnapshot` before the job is
 * queued, so nothing a user edits afterwards can change what a pending job
 * writes. `sourceIds` is derived by intersecting fact provenance with the
 * project's actual sources, which is what keeps intelligence entity ids out of
 * claim provenance.
 */
export async function buildWritingContext(
  input: WritingContextInput,
  deps: WritingContextDependencies,
): Promise<WritingContext> {
  const [product, brand, intent, direction, scene, knownSourceIds, intelligenceVersion] =
    await Promise.all([
      deps.loadProduct(input.projectId),
      deps.loadBrand(input.projectId),
      deps.loadIntent(input.projectId, input.intentId),
      deps.loadDirection(input.projectId, input.directionId),
      deps.loadScene(input.projectId, input.storyboardId, input.sceneId),
      deps.listKnownSourceIds(input.projectId),
      deps.loadIntelligenceVersion(input.projectId),
    ]);

  const facts = buildFacts(product, new Set(knownSourceIds));

  return {
    projectId: input.projectId,
    blockType: input.blockType,
    objective: input.objective,
    tone: input.tone,
    length: input.length,
    audience: resolveAudience(input.audience, product),
    language: input.language,
    userRequest: input.userRequest,
    product,
    brand,
    intent,
    direction,
    scene,
    sourceIds: collectSourceIds(facts),
    facts,
    brandVersion: brand.version,
    intelligenceVersion,
    createdAt: new Date().toISOString(),
  };
}
