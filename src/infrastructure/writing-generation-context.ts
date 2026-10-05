import type { BrandRepository } from "../core/ports/brand-repository";
import type { ContentIntentRepository } from "../core/ports/content-intent-repository";
import type { CreativeDirectionRepository } from "../core/ports/creative-direction-repository";
import type { IntelligenceRepository } from "../core/ports/intelligence-repository";
import type { SourceRepository } from "../core/ports/source-repository";
import type { StoryboardRepository } from "../core/ports/storyboard-repository";
import type {
  Benefit,
  Claim,
  Feature,
  Problem,
  Product,
  Workflow,
} from "../core/domain/intelligence";
import type { BrandProfile } from "../core/domain/brand";
import type { WritingContextDependencies } from "../modules/writing-engine/context/build-writing-context";
import type {
  WritingBrandContext,
  WritingDirectionContext,
  WritingIntentContext,
  WritingProductContext,
  WritingSceneContext,
} from "../modules/writing-engine/domain/types";

export type WritingContextRepositories = {
  brand: BrandRepository;
  intelligence: IntelligenceRepository;
  contentIntents: ContentIntentRepository;
  creativeDirections: CreativeDirectionRepository;
  storyboards: StoryboardRepository;
  sources: SourceRepository;
};

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const EMPTY_PRODUCT: WritingProductContext = {
  name: null,
  category: null,
  purpose: null,
  shortDescription: null,
  longDescription: null,
  valueProposition: null,
  targetUser: null,
  sourceIds: [],
  features: [],
  benefits: [],
  problems: [],
  workflows: [],
  claims: [],
  audienceSignals: [],
};

const EMPTY_BRAND: WritingBrandContext = {
  name: null,
  tagline: null,
  valueProposition: null,
  positioning: null,
  voiceSummary: null,
  preferredTerms: [],
  prohibitedTerms: [],
  voiceSignals: [],
  guidelines: [],
  version: null,
};

function entitySources(entity: { provenance: { sourceIds: string[] } | null }): string[] {
  return entity.provenance?.sourceIds ?? [];
}

function toWritingProduct(
  product: Product | null,
  features: Feature[],
  benefits: Benefit[],
  problems: Problem[],
  workflows: Workflow[],
  claims: Claim[],
  audienceSignals: Array<{ id: string; segment: string; description: string | null; provenance: { sourceIds: string[] } | null }>,
): WritingProductContext {
  if (!product) return { ...EMPTY_PRODUCT };

  return {
    name: product.name,
    category: product.category,
    purpose: product.purpose,
    shortDescription: product.shortDescription,
    longDescription: product.longDescription,
    valueProposition: product.valueProposition,
    targetUser: product.targetUserSummary,
    sourceIds: entitySources(product),
    features: features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      description: feature.description,
      sourceIds: entitySources(feature),
    })),
    benefits: benefits.map((benefit) => ({
      id: benefit.id,
      name: benefit.name,
      description: benefit.description,
      sourceIds: entitySources(benefit),
    })),
    problems: problems.map((problem) => ({
      id: problem.id,
      name: problem.name,
      description: problem.description,
      sourceIds: entitySources(problem),
    })),
    workflows: workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((step) => step.action),
      sourceIds: entitySources(workflow),
    })),
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceIds: [
        ...new Set([
          ...entitySources(claim),
          ...(claim.sourceId ? [claim.sourceId] : []),
        ]),
      ],
    })),
    audienceSignals: audienceSignals.map((signal) => ({
      id: signal.id,
      segment: signal.segment,
      description: signal.description,
      sourceIds: entitySources(signal),
    })),
  };
}

function toWritingBrand(profile: BrandProfile | null): WritingBrandContext {
  if (!profile) return { ...EMPTY_BRAND };

  return {
    name: profile.name,
    tagline: profile.tagline,
    valueProposition: profile.valueProposition,
    positioning: profile.positioning,
    voiceSummary: profile.voiceSummary,
    preferredTerms: profile.terms
      .filter((term) => term.preference === "PREFERRED")
      .map((term) => term.term),
    prohibitedTerms: profile.terms
      .filter((term) => term.preference === "AVOID")
      .map((term) => term.term),
    voiceSignals: profile.voiceSignals.map((signal) => signal.value),
    guidelines: profile.guidelines.map((guideline) => ({
      title: guideline.title,
      detail: guideline.detail,
    })),
    version: profile.version,
  };
}

/**
 * Adapts the real CP06/CP08/CP09/CP10/CP11 repositories to the snapshot shape the
 * writing engine reads. Reads are project-scoped, and a supplied id belonging to
 * another project resolves to null rather than leaking it.
 */
export function createWritingGenerationContextDependencies(
  repositories: WritingContextRepositories,
): WritingContextDependencies {
  return {
    loadProduct: async (projectId) => {
      const [product, features, benefits, problems, workflows, claims, audienceSignals] =
        await Promise.all([
          repositories.intelligence.getProduct(projectId),
          repositories.intelligence.listFeatures(projectId),
          repositories.intelligence.listBenefits(projectId),
          repositories.intelligence.listProblems(projectId),
          repositories.intelligence.listWorkflows(projectId),
          repositories.intelligence.listClaims(projectId),
          repositories.intelligence.listAudienceSignals(projectId),
        ]);
      return toWritingProduct(
        product,
        features,
        benefits,
        problems,
        workflows,
        claims,
        audienceSignals,
      );
    },

    loadBrand: async (projectId) =>
      toWritingBrand(await repositories.brand.getByProjectId(projectId)),

    loadIntent: async (projectId, intentId) => {
      let intent = intentId
        ? await repositories.contentIntents.getById(intentId)
        : null;
      if (intent && intent.projectId !== projectId) intent = null;

      if (!intent) {
        intent = newestFirst(
          await repositories.contentIntents.listForProject(projectId),
        )[0] ?? null;
      }
      if (!intent) return null;

      const context: WritingIntentContext = {
        id: intent.id,
        channel: intent.channel ?? null,
        contentType: intent.contentTypeId ?? null,
        tone: intent.tone ?? null,
        audience: intent.audience ?? null,
        cta: intent.cta ?? null,
        platforms: [...intent.platforms],
      };
      return context;
    },

    loadDirection: async (projectId, directionId) => {
      let direction = directionId
        ? await repositories.creativeDirections.getById(directionId)
        : null;
      if (direction && direction.projectId !== projectId) direction = null;

      if (!direction) {
        direction = newestFirst(
          await repositories.creativeDirections.listByProject(projectId),
        )[0] ?? null;
      }
      if (!direction) return null;

      const context: WritingDirectionContext = {
        id: direction.id,
        angle: direction.angle ?? null,
        thesis: direction.thesis ?? null,
        hook: direction.hook?.statement ?? null,
        cta: direction.cta ?? null,
        voiceDirection: direction.voiceDirection ?? null,
        audienceAngle: direction.audienceAngle ?? null,
      };
      return context;
    },

    loadScene: async (projectId, storyboardId, sceneId) => {
      let storyboard = storyboardId
        ? await repositories.storyboards.getById(storyboardId)
        : null;
      if (storyboard && storyboard.projectId !== projectId) storyboard = null;

      if (!storyboard) {
        storyboard = newestFirst(
          await repositories.storyboards.listByProject(projectId),
        )[0] ?? null;
      }
      if (!storyboard) return null;

      const scene = sceneId
        ? storyboard.scenes.find((candidate) => candidate.id === sceneId)
        : storyboard.scenes[0];
      if (!scene) return null;

      const context: WritingSceneContext = {
        storyboardId: storyboard.id,
        sceneId: scene.id,
        type: scene.type,
        name: scene.name,
        purpose: scene.purpose,
        voiceover: scene.voiceoverPlan?.text ?? null,
        textOverlays: scene.textOverlays.map((overlay) => overlay.text),
        claimIds: [...scene.claimIds],
        featureIds: [...scene.featureIds],
      };
      return context;
    },

    listKnownSourceIds: async (projectId) => {
      const sources = await repositories.sources.listByProject(projectId);
      return sources.map((source) => source.id);
    },

    loadIntelligenceVersion: async (projectId) => {
      const snapshot = await repositories.intelligence.latestSnapshot(projectId);
      return snapshot?.version ?? null;
    },
  };
}
