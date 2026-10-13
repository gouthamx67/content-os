import type { PublicOrm } from "../prisma/db";
import type {
  CampaignArtifacts,
  CampaignGroundingProvider,
} from "../modules/campaign-engine/integrations/ports";
import type { LaunchKitAsset } from "../modules/campaign-engine/domain/types";

/**
 * The narrow slices of the owning repositories the campaign engine needs.
 *
 * Each entry is exactly the method the engine calls, so the wiring cannot reach
 * past what the campaign is allowed to read and the engines keep owning their own
 * tables. The global id checks fall back to the ORM only to tell a deleted link
 * apart from one that belongs to another project.
 */
export type CampaignIntegrationDeps = {
  orm: PublicOrm;
  sources: {
    listByProject(projectId: string): Promise<readonly { id: string }[]>;
    getById(id: string): Promise<{ projectId: string } | null>;
  };
  assets: {
    getById(id: string): Promise<{
      id: string;
      projectId: string;
      type: string;
      name: string;
      metadata: string | null;
    } | null>;
  };
  contentIntents: {
    listForProject(
      projectId: string,
    ): Promise<readonly { platforms: readonly string[] }[]>;
    getById(id: string): Promise<{ projectId: string } | null>;
  };
  brand: {
    getByProjectId(projectId: string): Promise<{ version: number } | null>;
  };
  intelligence: {
    latestSnapshot(projectId: string): Promise<{ version: number } | null>;
  };
  writing: {
    getDocument(
      projectId: string,
      documentId: string,
    ): Promise<{ title: string; content: string } | null>;
  };
  adaptations: {
    getBatch(projectId: string, batchId: string): Promise<{ projectId: string } | null>;
  };
  images: {
    getDocument(projectId: string, documentId: string): Promise<unknown | null>;
  };
  editor: {
    getDocument(projectId: string, documentId: string): Promise<unknown | null>;
  };
};

export function createCampaignGroundingProvider(
  deps: CampaignIntegrationDeps,
): CampaignGroundingProvider {
  return {
    async gather(projectId) {
      const [sources, brand, snapshot, intents] = await Promise.all([
        deps.sources.listByProject(projectId),
        deps.brand.getByProjectId(projectId),
        deps.intelligence.latestSnapshot(projectId),
        deps.contentIntents.listForProject(projectId),
      ]);

      const projectPlatforms = [
        ...new Set(intents.flatMap((intent) => [...intent.platforms])),
      ].filter(Boolean);

      return {
        sourceIds: sources.map((source) => source.id),
        brandVersion: brand?.version ?? null,
        intelligenceVersion: snapshot?.version ?? null,
        projectPlatforms,
      };
    },
  };
}

export function createCampaignArtifacts(
  deps: CampaignIntegrationDeps,
): CampaignArtifacts {
  return {
    async locate(projectId, kind, id) {
      switch (kind) {
        case "source": {
          const source = await deps.sources.getById(id);
          if (!source) return "MISSING";
          return source.projectId === projectId ? "FOUND" : "FOREIGN";
        }
        case "intent": {
          const intent = await deps.contentIntents.getById(id);
          if (!intent) return "MISSING";
          return intent.projectId === projectId ? "FOUND" : "FOREIGN";
        }
        case "asset": {
          const asset = await deps.assets.getById(id);
          if (!asset) return "MISSING";
          return asset.projectId === projectId ? "FOUND" : "FOREIGN";
        }
        case "writing": {
          const document = await deps.writing.getDocument(projectId, id);
          if (document) return "FOUND";
          return (await exists(deps.orm.WritingDocument, id)) ? "FOREIGN" : "MISSING";
        }
        case "adaptation": {
          const batch = await deps.adaptations.getBatch(projectId, id);
          if (batch) return "FOUND";
          return (await exists(deps.orm.AdaptationBatch, id)) ? "FOREIGN" : "MISSING";
        }
        case "editor": {
          const document = await deps.editor.getDocument(projectId, id);
          if (document) return "FOUND";
          return (await exists(deps.orm.EditorDocument, id)) ? "FOREIGN" : "MISSING";
        }
        case "graphic": {
          const document = await deps.images.getDocument(projectId, id);
          if (document) return "FOUND";
          return (await exists(deps.orm.GraphicDocument, id)) ? "FOREIGN" : "MISSING";
        }
        default: {
          const exhaustive: never = kind;
          return exhaustive;
        }
      }
    },

    async copy(projectId, documentId) {
      const document = await deps.writing.getDocument(projectId, documentId);
      if (!document) return null;
      return { title: document.title, content: document.content };
    },

    async assets(projectId, assetIds) {
      const resolved: LaunchKitAsset[] = [];
      for (const assetId of assetIds) {
        const asset = await deps.assets.getById(assetId);
        if (!asset || asset.projectId !== projectId) continue;
        resolved.push({
          id: asset.id,
          name: asset.name,
          mimeType: mimeTypeFor(asset.type, asset.metadata),
          kind: kindFor(asset.type),
        });
      }
      return resolved;
    },
  };
}

async function exists(
  table: { where(filter: { id: string }): { first(): Promise<unknown> } },
  id: string,
): Promise<boolean> {
  const row = await table.where({ id }).first();
  return row !== null && row !== undefined;
}

function kindFor(type: string): LaunchKitAsset["kind"] {
  switch (type) {
    case "IMAGE":
    case "SCREENSHOT":
    case "UI_CAPTURE":
    case "LOGO":
      return "IMAGE";
    case "VIDEO":
      return "VIDEO";
    case "AUDIO":
      return "AUDIO";
    default:
      return "FILE";
  }
}

function mimeTypeFor(type: string, metadata: string | null): string {
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      const candidate = parsed["mimeType"] ?? parsed["contentType"];
      if (typeof candidate === "string" && candidate.includes("/")) {
        return candidate;
      }
    } catch {
      // Asset metadata is not guaranteed to be JSON; fall back to the type.
    }
  }
  switch (kindFor(type)) {
    case "IMAGE":
      return "image/*";
    case "VIDEO":
      return "video/*";
    case "AUDIO":
      return "audio/*";
    default:
      return "application/octet-stream";
  }
}
