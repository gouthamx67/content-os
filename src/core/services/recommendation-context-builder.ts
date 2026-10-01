import type { IntelligenceRepository } from "../ports/intelligence-repository";
import type { BrandRepository } from "../ports/brand-repository";
import type { AssetRepository } from "../ports/asset-repository";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { StoryboardRepository } from "../ports/storyboard-repository";
import type { Storyboard } from "../domain/storyboard";
import { toBrandExecutionProfile } from "../domain/brand";
import type { ContentChannel } from "../domain/content-type";
import { getContentType } from "../domain/content-type";
import { PLATFORMS, getPlatform } from "../domain/platform";
import type {
  RecommendationAssetData,
  RecommendationAudienceData,
  RecommendationBenefitData,
  RecommendationClaimData,
  RecommendationContext,
  RecommendationExistingContent,
  RecommendationFeatureData,
  RecommendationProblemData,
  RecommendationProductData,
  RecommendationWorkflowData,
} from "../domain/recommendation-context";

/**
 * Assembles the recommendation context from what the project actually contains.
 *
 * This is the reason the API takes a projectId instead of a context: a caller
 * able to name its own features, claims or assets would be able to invent
 * capabilities. Everything below is read through project-scoped repositories, so
 * a recommendation can only ever be as grounded as the recorded project.
 *
 * One read per source, and every source degrades to empty rather than throwing:
 * a project with no brand profile should still get recommendations from its
 * features, flagged with what is missing.
 */

export type RecommendationContextBuilderDeps = {
  intelligenceRepository: IntelligenceRepository;
  brandRepository: BrandRepository;
  assetRepository: AssetRepository;
  intentRepository: ContentIntentRepository;
  storyboardRepository: StoryboardRepository;
};

const CONFIDENCE_VALUE: Record<string, number> = {
  HIGH: 90,
  MEDIUM: 60,
  LOW: 30,
};

function confidenceValue(value: string): number {
  return CONFIDENCE_VALUE[value] ?? 30;
}

/** Asset types that make a visual opportunity plausible. */
const VISUAL_ASSET_TYPES = new Set([
  "IMAGE",
  "VIDEO",
  "SCREENSHOT",
  "UI_CAPTURE",
]);

export class RecommendationContextBuilder {
  constructor(private readonly deps: RecommendationContextBuilderDeps) {}

  async build(projectId: string): Promise<RecommendationContext> {
    const [graph, brand, assets, intents, storyboards] = await Promise.all([
      this.deps.intelligenceRepository.readGraph(projectId).catch(() => null),
      this.deps.brandRepository.getByProjectId(projectId).catch(() => null),
      this.deps.assetRepository.listByProject(projectId).catch(() => []),
      this.deps.intentRepository.listForProject(projectId).catch(() => []),
      this.deps.storyboardRepository
        .listByProject(projectId)
        .catch(() => [] as Storyboard[]),
    ]);

    const features: RecommendationFeatureData[] = (graph?.features ?? []).map(
      (feature) => ({
        id: feature.id,
        name: feature.name,
        description: feature.description,
        category: feature.category,
        importance: feature.importance,
        confidence: confidenceValue(feature.confidence),
        sourceIds: feature.provenance?.sourceIds ?? [],
        evidenceIds: feature.provenance?.evidenceIds ?? [],
      }),
    );

    const workflows: RecommendationWorkflowData[] = (graph?.workflows ?? []).map(
      (workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps.map((step) => step.action),
        featureIds: workflow.featureIds,
        confidence: confidenceValue(workflow.confidence),
        sourceIds: workflow.provenance?.sourceIds ?? [],
        evidenceIds: workflow.provenance?.evidenceIds ?? [],
      }),
    );

    const problems: RecommendationProblemData[] = (graph?.problems ?? []).map(
      (problem) => ({
        id: problem.id,
        name: problem.name,
        description: problem.description,
        confidence: confidenceValue(problem.confidence),
        sourceIds: problem.provenance?.sourceIds ?? [],
        evidenceIds: problem.provenance?.evidenceIds ?? [],
      }),
    );

    const benefits: RecommendationBenefitData[] = (graph?.benefits ?? []).map(
      (benefit) => ({
        id: benefit.id,
        name: benefit.name,
        description: benefit.description,
        confidence: confidenceValue(benefit.confidence),
        sourceIds: benefit.provenance?.sourceIds ?? [],
        evidenceIds: benefit.provenance?.evidenceIds ?? [],
      }),
    );

    const claims: RecommendationClaimData[] = (graph?.claims ?? []).map((claim) => ({
      id: claim.id,
      text: claim.text,
      claimType: claim.claimType,
      verification: claim.verification,
      confidence: confidenceValue(claim.confidence),
      sourceIds: claim.provenance?.sourceIds ?? [],
      evidenceIds: claim.provenance?.evidenceIds ?? [],
    }));

    const assetData: RecommendationAssetData[] = assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: VISUAL_ASSET_TYPES.has(asset.type) ? "VISUAL" : null,
    }));

    const audienceSignals: RecommendationAudienceData[] = (
      graph?.audienceSignals ?? []
    ).map((signal) => ({
      id: signal.id,
      segment: signal.segment,
      description: signal.description,
      confidence: confidenceValue(signal.confidence),
    }));

    const product: RecommendationProductData | null = graph?.product
      ? {
          name: graph.product.name ?? "the product",
          description:
            graph.product.shortDescription ?? graph.product.longDescription,
          confidence: confidenceValue(graph.product.confidence),
          category: graph.product.category,
          valueProposition: graph.product.valueProposition,
          sourceIds: graph.product.provenance?.sourceIds ?? [],
          evidenceIds: graph.product.provenance?.evidenceIds ?? [],
        }
      : null;

    const existingContent = buildExistingContent(intents, storyboards);

    const channelsUsed = deriveChannelsUsed(existingContent, assetData);
    const availablePlatforms = deriveAvailablePlatforms(
      existingContent,
      channelsUsed,
      brand ? toBrandExecutionProfile(brand) : null,
    );

    return {
      projectId,
      product,
      brand: brand ? toBrandExecutionProfile(brand) : null,
      features,
      workflows,
      problems,
      benefits,
      claims,
      assets: assetData,
      audienceSignals,
      existingContent,
      channelsUsed,
      availablePlatforms,
      platformPriority: derivePlatformPriority(existingContent),
    };
  }
}

/**
 * Existing content is derived from records that already exist: a CP09 intent is
 * a decision to make something, and a CP11 storyboard is a decision that became
 * a plan. Neither is read as "published" — the engine has no analytics yet — but
 * both mean the area is not untouched.
 */
function buildExistingContent(
  intents: ReadonlyArray<{
    id: string;
    contentTypeId: string;
    platforms: string[];
    subjects: { type: string; id: string }[];
    createdAt: string;
  }>,
  storyboards: readonly Storyboard[],
): RecommendationExistingContent[] {
  const intentById = new Map(intents.map((intent) => [intent.id, intent]));

  const fromIntents: RecommendationExistingContent[] = intents.map((intent) => ({
    id: intent.id,
    contentTypeId: intent.contentTypeId,
    platformIds: intent.platforms,
    subjectIds: intent.subjects.map((subject) => subject.id),
    createdAt: intent.createdAt,
  }));

  // A storyboard inherits its content type and platforms from its intent, which
  // is why the intent map is needed here rather than a second lookup path.
  const fromStoryboards: RecommendationExistingContent[] = [];
  for (const storyboard of storyboards) {
    const intent = intentById.get(storyboard.intentId);
    if (!intent) continue;
    fromStoryboards.push({
      id: storyboard.id,
      contentTypeId: intent.contentTypeId,
      platformIds: intent.platforms,
      subjectIds: intent.subjects.map((subject) => subject.id),
      createdAt: storyboard.createdAt,
    });
  }

  return [...fromIntents, ...fromStoryboards];
}

function deriveChannelsUsed(
  existingContent: readonly RecommendationExistingContent[],
  assets: readonly RecommendationAssetData[],
): string[] {
  const channels = new Set<string>();

  for (const content of existingContent) {
    const definition = getContentType(content.contentTypeId);
    if (definition) channels.add(definition.channel);
  }

  // A project that has only uploaded images has shown an interest in visuals
  // even if nothing has been generated from them yet.
  if (assets.some((asset) => asset.role === "VISUAL")) channels.add("IMAGE");
  if (assets.some((asset) => asset.type === "VIDEO")) channels.add("VIDEO");
  if (assets.some((asset) => asset.type === "AUDIO")) channels.add("AUDIO");

  return [...channels];
}

/**
 * Platforms the project can publish to: those already used, plus those the
 * CP09 registry says carry a channel the project has demonstrated interest in.
 * Derived rather than hardcoded so this can move as workspace tiers exist.
 */
function deriveAvailablePlatforms(
  existingContent: readonly RecommendationExistingContent[],
  channelsUsed: readonly string[],
  brand: ReturnType<typeof toBrandExecutionProfile> | null,
): string[] {
  const platforms = new Set<string>();

  for (const content of existingContent) {
    for (const platform of content.platformIds) platforms.add(platform);
  }

  for (const channel of channelsUsed) {
    for (const platform of platformsForChannel(channel)) platforms.add(platform);
  }

  // Brand visual assets imply LinkedIn and web presence without assuming voice
  // or campaign intent.
  if (brand && brand.visual.assets.length > 0) {
    platforms.add("linkedin");
    platforms.add("website");
  }

  return [...platforms].filter((platform) => Boolean(getPlatform(platform)));
}

/**
 * Which platforms carry a channel, read from the CP09 platform registry rather
 * than a map written here. The registry already states each platform's channels
 * and each content type's supported platforms, so a second copy of that pairing
 * in the recommendation layer would be a second source of truth that could drift
 * from the one CP09 validates against.
 */
function platformsForChannel(channel: string): string[] {
  return PLATFORMS.filter((platform) =>
    platform.channels.includes(channel as ContentChannel),
  ).map((platform) => platform.id);
}

/**
 * Per-platform ranking weight, derived from what the project has actually
 * published to rather than from a configured preference that does not exist yet.
 *
 * A platform the project has already used once ranks above one it has never used,
 * which is a real signal (the project demonstrably can and does publish there)
 * and is the only platform preference CP12 will assert on its own. Platforms
 * with no recorded use get no entry at all and are scored neutrally, so an
 * unseen platform is never silently pushed to the bottom.
 */
function derivePlatformPriority(
  existingContent: readonly RecommendationExistingContent[],
): Record<string, number> {
  const uses = new Map<string, number>();

  for (const content of existingContent) {
    for (const platform of content.platformIds) {
      uses.set(platform, (uses.get(platform) ?? 0) + 1);
    }
  }

  const priority: Record<string, number> = {};
  for (const [platform, count] of uses) {
    priority[platform] = Math.min(90, 60 + count * 10);
  }

  return priority;
}
