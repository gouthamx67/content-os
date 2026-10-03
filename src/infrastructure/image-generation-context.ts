import type { AssetRepository } from "../core/ports/asset-repository";
import type { BrandRepository } from "../core/ports/brand-repository";
import type { ContentIntentRepository } from "../core/ports/content-intent-repository";
import type { CreativeDirectionRepository } from "../core/ports/creative-direction-repository";
import type { IntelligenceRepository } from "../core/ports/intelligence-repository";
import type { StoryboardRepository } from "../core/ports/storyboard-repository";
import { toGenerationBrand } from "../modules/image-generation/context/brand-context";
import type { GenerationContextDependencies } from "../modules/image-generation/context/build-generation-context";
import { toGenerationProduct } from "../modules/image-generation/context/product-context";

export type ImageContextRepositories = {
  brand: BrandRepository;
  intelligence: IntelligenceRepository;
  contentIntents: ContentIntentRepository;
  creativeDirections: CreativeDirectionRepository;
  storyboards: StoryboardRepository;
  assets: AssetRepository;
};

const IMAGE_ASSET_TYPES = new Set(["IMAGE", "LOGO", "SCREENSHOT", "UI_CAPTURE"]);

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Adapts the real CP06/CP08/CP09/CP10/CP11 repositories to the snapshot shape
 * templates read. Reads are project-scoped and a supplied id that belongs to a
 * different project resolves to null rather than leaking another project's data.
 */
export function createImageGenerationContextDependencies(
  repositories: ImageContextRepositories,
): GenerationContextDependencies {
  return {
    loadProduct: async (projectId) => {
      const [product, features, claims] = await Promise.all([
        repositories.intelligence.getProduct(projectId),
        repositories.intelligence.listFeatures(projectId),
        repositories.intelligence.listClaims(projectId),
      ]);
      return toGenerationProduct(product, features, claims);
    },

    loadBrand: async (projectId) =>
      toGenerationBrand(await repositories.brand.getByProjectId(projectId)),

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

      return {
        id: intent.id,
        channel: intent.channel,
        contentType: intent.contentTypeId,
        tone: intent.tone ?? null,
        audience: intent.audience ?? null,
        rawRequest: intent.rawRequest,
      };
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

      return {
        id: direction.id,
        thesis: direction.thesis,
        visualStyle: direction.visualStrategy.approach,
        voice: direction.voiceDirection,
      };
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

      return {
        storyboardId: storyboard.id,
        sceneId: scene.id,
        text: scene.purpose,
        visualType: scene.type,
      };
    },

    loadIntelligenceVersion: async () => null,

    listSourceAssetIds: async (projectId) => {
      const assets = await repositories.assets.listByProject(projectId);
      return assets
        .filter((asset) => IMAGE_ASSET_TYPES.has(asset.type))
        .map((asset) => asset.id);
    },
  };
}
