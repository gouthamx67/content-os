import type {
  CampaignDeliverableRecord,
  CampaignReadiness,
  CampaignRecord,
  LaunchKit,
  LaunchKitAsset,
  LaunchKitCopy,
} from "./types";
import { orderDeliverables } from "./schedule";
import { campaignHash } from "../serialization/canonical";
import { platformDisplayName } from "./channels";

export const LAUNCH_KIT_SCHEMA = "content-os.campaign-launch-kit";
export const LAUNCH_KIT_VERSION = 1;

export type LaunchKitBuildInput = {
  campaign: CampaignRecord;
  deliverables: readonly CampaignDeliverableRecord[];
  readiness: CampaignReadiness;
  copy: ReadonlyMap<string, LaunchKitCopy | null>;
  assets: ReadonlyMap<string, readonly LaunchKitAsset[]>;
  assembledAt: string;
};

/**
 * Builds the Launch Kit and its digest.
 *
 * The digest covers a projection that deliberately omits `assembledAt` and the
 * readiness timestamp: a kit re-assembled tomorrow from unchanged inputs is the
 * same kit, and the hash has to say so. Everything a publisher consumes — the
 * brief, the strategy, the ordered deliverables, the copy text, the asset ids —
 * is inside it, which is why the hash can stand in for approval.
 */
export function buildLaunchKit(input: LaunchKitBuildInput): {
  kit: LaunchKit;
  hash: string;
} {
  const ordered = orderDeliverables(input.deliverables);

  const kit: LaunchKit = {
    version: LAUNCH_KIT_VERSION,
    assembledAt: input.assembledAt,
    campaign: {
      id: input.campaign.id,
      projectId: input.campaign.projectId,
      name: input.campaign.name,
      objective: input.campaign.objective,
      audienceSummary: input.campaign.audienceSummary,
      keyMessage: input.campaign.keyMessage,
      status: input.campaign.status,
    },
    strategy: input.campaign.strategy,
    deliverables: ordered.map((deliverable) => ({
      id: deliverable.id,
      title: deliverable.title,
      channel: deliverable.channel,
      platformId: deliverable.platformId,
      platformName: platformDisplayName(deliverable.platformId),
      contentTypeId: deliverable.contentTypeId,
      status: deliverable.status,
      scheduledFor: deliverable.scheduledFor,
      brief: deliverable.brief,
      links: deliverable.links,
      copy: input.copy.get(deliverable.id) ?? null,
      assets: [...(input.assets.get(deliverable.id) ?? [])],
    })),
    grounding: input.campaign.strategy?.groundedIn ?? {
      sourceIds: input.campaign.brief.sourceIds,
      intelligenceVersion: null,
      brandVersion: null,
    },
    readiness: {
      ready: input.readiness.ready,
      blocking: input.readiness.summary.blocking,
      warning: input.readiness.summary.warning,
    },
  };

  return { kit, hash: launchKitHash(kit) };
}

/**
 * The digest of a kit's meaning, independent of when it was assembled. Exported
 * so an export can be verified against the hash that was stored when the kit was
 * frozen.
 */
export function launchKitHash(kit: LaunchKit): string {
  return campaignHash(launchKitDigestPayload(kit));
}

function launchKitDigestPayload(kit: LaunchKit): unknown {
  return {
    version: kit.version,
    campaign: {
      id: kit.campaign.id,
      projectId: kit.campaign.projectId,
      name: kit.campaign.name,
      objective: kit.campaign.objective,
      audienceSummary: kit.campaign.audienceSummary,
      keyMessage: kit.campaign.keyMessage,
    },
    strategy: kit.strategy,
    deliverables: kit.deliverables.map((deliverable) => ({
      id: deliverable.id,
      title: deliverable.title,
      channel: deliverable.channel,
      platformId: deliverable.platformId,
      contentTypeId: deliverable.contentTypeId,
      scheduledFor: deliverable.scheduledFor,
      brief: deliverable.brief,
      links: deliverable.links,
      copy: deliverable.copy,
      assets: deliverable.assets,
    })),
    grounding: kit.grounding,
    readiness: {
      ready: kit.readiness.ready,
      blocking: kit.readiness.blocking,
      warning: kit.readiness.warning,
    },
  };
}

/**
 * The export document is thin on purpose: a versioned envelope around the kit.
 * Encoding the schema name here means a future consumer can refuse a shape it
 * does not understand instead of guessing.
 */
export function toExportDocument(kit: LaunchKit): Record<string, unknown> {
  const document = {
    schema: LAUNCH_KIT_SCHEMA,
    version: LAUNCH_KIT_VERSION,
    assembledAt: kit.assembledAt,
    launchKit: kit,
  } as Record<string, unknown>;
  assertNoLeaks(document);
  return document;
}

const FORBIDDEN_KEY = /(secret|token|password|api[_-]?key)/i;
const PATH_LIKE = /(^|[^:\w])(?:\/home\/|\/Users\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/;
const SECRET_LIKE = /(?:api[_-]?key|secret|token)\s*[:=]/i;

/**
 * A Launch Kit leaves the app and is handed to a publisher, so it must not carry
 * a filesystem path or a credential. The kit is assembled from public fields by
 * construction; this guard exists so that a field added later cannot quietly
 * smuggle one through.
 */
function assertNoLeaks(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    if (PATH_LIKE.test(value)) {
      throw new Error(`Launch Kit export contains a filesystem path at ${path}`);
    }
    if (SECRET_LIKE.test(value)) {
      throw new Error(`Launch Kit export contains a secret-looking value at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLeaks(entry, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new Error(`Launch Kit export contains a forbidden field: ${key}`);
      }
      assertNoLeaks(entry, `${path}.${key}`);
    }
  }
}
