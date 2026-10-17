import { db } from "../../prisma/db";
import type { PublicOrm, Transaction } from "../../prisma/db";
import { pgTimestampToIso } from "../../lib/time";
import type {
  AddDeliverableInput,
  AssembledKit,
  CampaignMutationBase,
  CampaignMutationResult,
  CampaignRepository,
  CampaignRevisionInput,
  CampaignRevisionListFilter,
  CreateCampaignInput,
  NewDeliverableInput,
  RemoveDeliverableInput,
  SetAssemblyInput,
  SetBriefInput,
  SetLifecycleInput,
  SetScheduleInput,
  SetStrategyInput,
  UpdateDeliverableInput,
} from "../../core/ports/campaign-repository";
import type {
  CampaignBrief,
  CampaignDeliverableRecord,
  CampaignPlan,
  CampaignRecord,
  CampaignRevisionRecord,
  CampaignStatus,
  LaunchKit,
  LaunchStrategy,
} from "../../modules/campaign-engine/domain/types";
import { parseStoredJson } from "../../modules/campaign-engine/serialization/canonical";

type CampaignRow = {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
  brief: string;
  status: string;
  strategy: string | null;
  plan: string | null;
  revisionNumber: number;
  approvalHash: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  launchKit: string | null;
  launchKitHash: string | null;
  assembledAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type DeliverableRow = {
  id: string;
  campaignId: string;
  projectId: string;
  title: string;
  channel: string;
  platformId: string;
  contentTypeId: string;
  brief: string;
  links: string;
  position: number;
  status: string;
  scheduledFor: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

type RevisionRow = {
  id: string;
  campaignId: string;
  revisionNumber: number;
  kind: string;
  payload: string;
  createdById: string;
  createdAt: string;
};

function decodeCampaign(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    objective: row.objective,
    audienceSummary: row.audienceSummary,
    keyMessage: row.keyMessage,
    brief: parseStoredJson<CampaignBrief>(row.brief, "campaign brief"),
    status: row.status as CampaignStatus,
    strategy: row.strategy
      ? parseStoredJson<LaunchStrategy>(row.strategy, "campaign strategy")
      : null,
    plan: row.plan
      ? parseStoredJson<CampaignPlan>(row.plan, "campaign plan")
      : null,
    revisionNumber: row.revisionNumber,
    approvalHash: row.approvalHash,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt ? pgTimestampToIso(row.approvedAt) : null,
    launchKitHash: row.launchKitHash,
    assembledAt: row.assembledAt ? pgTimestampToIso(row.assembledAt) : null,
    hasLaunchKit: row.launchKit !== null,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeDeliverable(row: DeliverableRow): CampaignDeliverableRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    projectId: row.projectId,
    title: row.title,
    channel: row.channel as CampaignDeliverableRecord["channel"],
    platformId: row.platformId,
    contentTypeId: row.contentTypeId,
    brief: parseStoredJson<CampaignDeliverableRecord["brief"]>(row.brief, "deliverable brief"),
    links: parseStoredJson<CampaignDeliverableRecord["links"]>(row.links, "deliverable links"),
    position: row.position,
    status: row.status as CampaignDeliverableRecord["status"],
    scheduledFor: row.scheduledFor ? pgTimestampToIso(row.scheduledFor) : null,
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function decodeRevision(row: RevisionRow): CampaignRevisionRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    revisionNumber: row.revisionNumber,
    kind: row.kind as CampaignRevisionRecord["kind"],
    payload: parseStoredJson<Record<string, unknown>>(row.payload, "revision payload"),
    createdById: row.createdById,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function deliverableValues(input: NewDeliverableInput) {
  return {
    id: input.id,
    campaignId: input.campaignId,
    projectId: input.projectId,
    title: input.title,
    channel: input.channel,
    platformId: input.platformId,
    contentTypeId: input.contentTypeId,
    brief: JSON.stringify(input.brief),
    links: JSON.stringify(input.links),
    position: input.position,
    status: input.status,
    scheduledFor: input.scheduledFor,
    createdById: input.createdById,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function revisionValues(revision: CampaignRevisionInput) {
  return {
    id: revision.revisionId,
    campaignId: revision.campaignId,
    revisionNumber: revision.revisionNumber,
    kind: revision.kind,
    payload: JSON.stringify(revision.payload),
    createdById: revision.createdById,
    createdAt: revision.createdAt,
  };
}

function isRevisionOrdinalRace(error: unknown): boolean {
  const levels: unknown[] = [error];

  if (typeof error === "object" && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) levels.push(cause);
  }

  return levels.some((level) => {
    if (typeof level !== "object" || level === null) return false;
    const candidate = level as { code?: unknown; constraint?: unknown };
    return (
      candidate.code === "23505" &&
      typeof candidate.constraint === "string" &&
      candidate.constraint.startsWith("campaign_revision")
    );
  });
}

function overrideColumns(base: CampaignMutationBase): Record<string, unknown> {
  const columns: Record<string, unknown> = {};

  const lifecycle = base.lifecycle;
  if (lifecycle) {
    if (lifecycle.status !== undefined) columns["status"] = lifecycle.status;
    if (lifecycle.approvalHash !== undefined) {
      columns["approvalHash"] = lifecycle.approvalHash;
    }
    if (lifecycle.approvedById !== undefined) {
      columns["approvedById"] = lifecycle.approvedById;
    }
    if (lifecycle.approvedAt !== undefined) {
      columns["approvedAt"] = lifecycle.approvedAt;
    }
  }

  if (base.resetAssembly) {
    columns["launchKit"] = null;
    columns["launchKitHash"] = null;
    columns["assembledAt"] = null;
  }

  return columns;
}

export class PostgresCampaignRepository implements CampaignRepository {
  constructor(private readonly orm: PublicOrm = db.orm.public) {}

  async createCampaign(input: CreateCampaignInput): Promise<CampaignRecord> {
    await db.transaction(async (tx) => {
      await tx.orm.public.Campaign.create({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        objective: input.objective,
        audienceSummary: input.audienceSummary,
        keyMessage: input.keyMessage,
        brief: JSON.stringify(input.brief),
        status: input.status,
        strategy: null,
        plan: null,
        revisionNumber: input.firstRevision.revisionNumber,
        approvalHash: null,
        approvedById: null,
        approvedAt: null,
        launchKit: null,
        launchKitHash: null,
        assembledAt: null,
        createdById: input.createdById,
        createdAt: input.now,
        updatedAt: input.now,
      });

      await tx.orm.public.CampaignRevision.create(revisionValues(input.firstRevision));

      for (const deliverable of input.deliverables) {
        await tx.orm.public.CampaignDeliverable.create(deliverableValues(deliverable));
      }
    });

    const campaign = await this.getCampaign(input.projectId, input.id);
    if (!campaign) throw new Error("Campaign vanished during creation");
    return campaign;
  }

  async getCampaign(
    projectId: string,
    campaignId: string,
  ): Promise<CampaignRecord | null> {
    const row = (await this.orm.Campaign.where({ projectId, id: campaignId })
      .first()) as CampaignRow | null;
    return row ? decodeCampaign(row) : null;
  }

  async listCampaigns(projectId: string): Promise<CampaignRecord[]> {
    const rows = (await this.orm.Campaign.where({ projectId })
      .orderBy((row) => row.createdAt.desc())
      .all()) as unknown as CampaignRow[];
    return rows.map(decodeCampaign);
  }

  async getDeliverable(
    campaignId: string,
    deliverableId: string,
  ): Promise<CampaignDeliverableRecord | null> {
    const row = (await this.orm.CampaignDeliverable.where({
      campaignId,
      id: deliverableId,
    }).first()) as DeliverableRow | null;
    return row ? decodeDeliverable(row) : null;
  }

  async getDeliverableForProject(
    projectId: string,
    deliverableId: string,
  ): Promise<CampaignDeliverableRecord | null> {
    const row = (await this.orm.CampaignDeliverable.where({
      projectId,
      id: deliverableId,
    }).first()) as DeliverableRow | null;
    return row ? decodeDeliverable(row) : null;
  }

  async listDeliverables(campaignId: string): Promise<CampaignDeliverableRecord[]> {
    const rows = (await this.orm.CampaignDeliverable.where({ campaignId })
      .orderBy([(row) => row.position.asc(), (row) => row.id.asc()])
      .all()) as unknown as DeliverableRow[];
    return rows.map(decodeDeliverable);
  }

  async listRevisions(
    filter: CampaignRevisionListFilter,
  ): Promise<CampaignRevisionRecord[]> {
    const rows = (await this.orm.CampaignRevision.where({
      campaignId: filter.campaignId,
    })
      .orderBy((row) => row.revisionNumber.desc())
      .limit(filter.limit)
      .offset(filter.offset)
      .all()) as unknown as RevisionRow[];
    return rows.map(decodeRevision);
  }

  async countRevisions(campaignId: string): Promise<number> {
    const totals = await this.orm.CampaignRevision.where({ campaignId }).aggregate(
      (aggregate) => ({ total: aggregate.count() }),
    );
    return totals.total;
  }

  async getAssembledKit(
    projectId: string,
    campaignId: string,
  ): Promise<AssembledKit | null> {
    const row = (await this.orm.Campaign.where({ projectId, id: campaignId })
      .first()) as CampaignRow | null;
    if (!row || row.launchKit === null) return null;
    return {
      kit: parseStoredJson<LaunchKit>(row.launchKit, "launch kit"),
      hash: row.launchKitHash ?? "",
    };
  }

  async setStrategy(input: SetStrategyInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async (tx) => {
      for (const id of input.removeDeliverableIds) {
        await tx.orm.public.CampaignDeliverable.where({
          campaignId: input.campaignId,
          id,
        }).delete();
      }
      for (const deliverable of input.addDeliverables) {
        await tx.orm.public.CampaignDeliverable.create(deliverableValues(deliverable));
      }
      return {
        strategy: JSON.stringify(input.strategy),
        plan: JSON.stringify(input.plan),
      };
    });
  }

  async setBrief(input: SetBriefInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async () => {
      const patch: Record<string, unknown> = {};
      if (input.patch.name !== undefined) patch["name"] = input.patch.name;
      if (input.patch.objective !== undefined) patch["objective"] = input.patch.objective;
      if (input.patch.audienceSummary !== undefined) {
        patch["audienceSummary"] = input.patch.audienceSummary;
      }
      if (input.patch.keyMessage !== undefined) patch["keyMessage"] = input.patch.keyMessage;
      if (input.patch.brief !== undefined) {
        patch["brief"] = JSON.stringify(input.patch.brief);
      }
      return patch;
    });
  }

  async addDeliverable(input: AddDeliverableInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async (tx) => {
      await tx.orm.public.CampaignDeliverable.create(deliverableValues(input.deliverable));
      return {};
    });
  }

  async updateDeliverable(
    input: UpdateDeliverableInput,
  ): Promise<CampaignMutationResult> {
    return this.mutate(input, async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: input.now };
      if (input.patch.title !== undefined) patch["title"] = input.patch.title;
      if (input.patch.channel !== undefined) patch["channel"] = input.patch.channel;
      if (input.patch.platformId !== undefined) patch["platformId"] = input.patch.platformId;
      if (input.patch.contentTypeId !== undefined) {
        patch["contentTypeId"] = input.patch.contentTypeId;
      }
      if (input.patch.status !== undefined) patch["status"] = input.patch.status;
      if (input.patch.scheduledFor !== undefined) {
        patch["scheduledFor"] = input.patch.scheduledFor;
      }
      if (input.patch.brief !== undefined) patch["brief"] = JSON.stringify(input.patch.brief);
      if (input.patch.links !== undefined) patch["links"] = JSON.stringify(input.patch.links);

      await tx.orm.public.CampaignDeliverable.where({
        campaignId: input.campaignId,
        id: input.deliverableId,
      }).update(patch);
      return {};
    });
  }

  async removeDeliverable(
    input: RemoveDeliverableInput,
  ): Promise<CampaignMutationResult> {
    return this.mutate(input, async (tx) => {
      await tx.orm.public.CampaignDeliverable.where({
        campaignId: input.campaignId,
        id: input.deliverableId,
      }).delete();
      return {};
    });
  }

  async setSchedule(input: SetScheduleInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async (tx) => {
      for (const entry of input.entries) {
        await tx.orm.public.CampaignDeliverable.where({
          campaignId: input.campaignId,
          id: entry.deliverableId,
        }).update({ scheduledFor: entry.scheduledFor, updatedAt: input.now });
      }
      return {};
    });
  }

  async setLifecycle(input: SetLifecycleInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async () => ({}));
  }

  async setAssembly(input: SetAssemblyInput): Promise<CampaignMutationResult> {
    return this.mutate(input, async () => ({
      launchKit: input.launchKit,
      launchKitHash: input.launchKitHash,
      assembledAt: input.assembledAt,
    }));
  }

  /**
   * The optimistic unit of work every mutation shares.
   *
   * The head is claimed first, by an update that names the expected revision
   * number. Side effects and the revision row are only written after that claim
   * succeeds, so a stale writer's transaction has nothing to roll back and cannot
   * leave deliverable changes behind while losing the head.
   */
  private async mutate(
    base: CampaignMutationBase,
    apply: (
      tx: Transaction,
    ) => Promise<Record<string, unknown>>,
  ): Promise<CampaignMutationResult> {
    let claimed = false;

    try {
      await db.transaction(async (tx) => {
        const claimedRow = (await tx.orm.public.Campaign.where({
          projectId: base.projectId,
          id: base.campaignId,
          revisionNumber: base.expectedRevisionNumber,
        }).update({
          revisionNumber: base.expectedRevisionNumber + 1,
          updatedAt: base.now,
        })) as CampaignRow | null;

        if (!claimedRow) return;

        const patch = { ...(await apply(tx)), ...overrideColumns(base) };

        if (Object.keys(patch).length > 0) {
          await tx.orm.public.Campaign.where({
            projectId: base.projectId,
            id: base.campaignId,
          }).update(patch);
        }

        await tx.orm.public.CampaignRevision.create(revisionValues(base.revision));
        claimed = true;
      });
    } catch (error) {
      if (!isRevisionOrdinalRace(error)) throw error;
      const campaign = await this.getCampaign(base.projectId, base.campaignId);
      return { applied: false, campaign };
    }

    const campaign = await this.getCampaign(base.projectId, base.campaignId);
    return { applied: claimed, campaign };
  }
}

export const postgresCampaignRepository = new PostgresCampaignRepository();
