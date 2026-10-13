import type {
  AddDeliverableInput,
  CampaignHeadlinePatch,
  CampaignMutationBase,
  CampaignMutationResult,
  CampaignRepository,
  DeliverablePatch,
  NewDeliverableInput,
  RemoveDeliverableInput,
  SetLifecycleInput,
  SetScheduleInput,
  UpdateDeliverableInput,
} from "../../core/ports/campaign-repository";
import type {
  CampaignDetail,
  CampaignPlannerSource,
  CampaignRecord,
  CampaignRevisionKind,
  CampaignRevisionRecord,
  CampaignStatus,
  DeliverableLinks,
  LaunchKit,
  LaunchKitAsset,
  LaunchKitCopy,
} from "./domain/types";
import { emptyDeliverableLinks } from "./domain/types";
import { CampaignError } from "./errors";
import { resolveFormat } from "./domain/channels";
import { assertAction } from "./domain/lifecycle";
import {
  evaluateReadiness,
  type LinkResolution,
} from "./domain/readiness";
import { assertSchedulable, orderDeliverables } from "./domain/schedule";
import { buildLaunchKit, toExportDocument } from "./domain/launch-kit";
import {
  materializeProposal,
  type CampaignProposal,
  type MaterializedProposal,
  type PlannerContext,
} from "./planner";
import {
  ensureDeliverableCount,
  validateBrief,
  validateDeliverableBrief,
  validateHeadline,
} from "./domain/validation";
import { campaignHash } from "./serialization/canonical";
import type { ArtifactKind, CampaignArtifacts, CampaignGroundingProvider } from "./integrations/ports";

export type CampaignServiceDeps = {
  repository: CampaignRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  newId: (prefix: string) => string;
  now: () => string;
  grounding: CampaignGroundingProvider;
  artifacts: CampaignArtifacts;
};

export type CreateCampaignCommand = {
  userId: string;
  projectId: string;
  name: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
  brief?: unknown;
};

export type UpdateBriefCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  expectedRevisionNumber: number;
  patch: {
    name?: string;
    objective?: string;
    audienceSummary?: string;
    keyMessage?: string;
    brief?: unknown;
  };
};

export type PlanCampaignCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  expectedRevisionNumber?: number;
  proposal?: unknown;
};

export type AddDeliverableCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  expectedRevisionNumber: number;
  title: string;
  platformId: string;
  channel?: string | null;
  contentTypeId?: string | null;
  brief: unknown;
  links?: unknown;
  scheduledFor?: string | null;
};

export type UpdateDeliverableCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  deliverableId: string;
  expectedRevisionNumber: number;
  patch: {
    title?: string;
    platformId?: string;
    channel?: string | null;
    contentTypeId?: string | null;
    brief?: unknown;
    links?: unknown;
    status?: string;
    scheduledFor?: string | null;
  };
};

export type RemoveDeliverableCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  deliverableId: string;
  expectedRevisionNumber: number;
};

export type ScheduleCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  expectedRevisionNumber: number;
  entries: { deliverableId: string; scheduledFor: string }[];
};

export type TransitionCommand = {
  userId: string;
  projectId: string;
  campaignId: string;
  expectedRevisionNumber: number;
};

const DELIVERABLE_STATUSES = ["PLANNED", "IN_PROGRESS", "READY", "BLOCKED"] as const;

/**
 * The campaign engine's orchestration.
 *
 * It owns ordering, authorization hand-off, the readiness gate, and the one rule
 * that ties them together: a material change to an approved campaign drops the
 * approval and any assembled kit in the same write. Everything else — hashing,
 * lifecycle legality, format resolution — is delegated to the domain modules so
 * the service reads as a sequence of decisions rather than a pile of rules.
 */
export class CampaignService {
  constructor(private readonly deps: CampaignServiceDeps) {}

  async listCampaigns(userId: string, projectId: string): Promise<CampaignRecord[]> {
    await this.authorize(projectId, userId);
    return this.deps.repository.listCampaigns(projectId);
  }

  async getCampaign(
    userId: string,
    projectId: string,
    campaignId: string,
  ): Promise<CampaignDetail> {
    await this.authorize(projectId, userId);
    return this.load(projectId, campaignId);
  }

  async createCampaign(command: CreateCampaignCommand): Promise<CampaignDetail> {
    const { userId, projectId } = command;
    await this.authorize(projectId, userId);

    const headline = validateHeadline({
      name: command.name,
      objective: command.objective,
      audienceSummary: command.audienceSummary,
      keyMessage: command.keyMessage,
    });
    const brief = validateBrief(command.brief);

    const grounding = await this.deps.grounding.gather(projectId);
    this.assertSourcesExist(brief.sourceIds, grounding.sourceIds);

    const now = this.deps.now();
    const campaignId = this.deps.newId("campaign");

    await this.deps.repository.createCampaign({
      id: campaignId,
      projectId,
      ...headline,
      brief,
      status: "DRAFT",
      createdById: userId,
      now,
      firstRevision: {
        revisionId: this.deps.newId("campaignrev"),
        campaignId,
        revisionNumber: 1,
        kind: "CREATE",
        payload: { name: headline.name },
        createdById: userId,
        createdAt: now,
      },
      deliverables: [],
    });

    return this.load(projectId, campaignId);
  }

  async updateBrief(command: UpdateBriefCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const { campaign } = await this.load(projectId, campaignId);

    const patch: CampaignHeadlinePatch = {};
    const headline = validateHeadlinePartial(command.patch);
    Object.assign(patch, headline);
    const brief =
      command.patch.brief !== undefined ? validateBrief(command.patch.brief) : null;
    if (brief) {
      patch.brief = brief;
    }
    if (Object.keys(patch).length === 0) {
      return this.load(projectId, campaignId);
    }

    if (brief) {
      const grounding = await this.deps.grounding.gather(projectId);
      this.assertSourcesExist(brief.sourceIds, grounding.sourceIds);
    }

    const now = this.deps.now();
    const result = await this.deps.repository.setBrief({
      ...this.base(campaign, command.expectedRevisionNumber, "BRIEF_UPDATED", userId, now, {
        material: true,
        payload: { fields: Object.keys(patch) },
      }),
      patch,
    });

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async proposePlan(
    userId: string,
    projectId: string,
    campaignId: string,
    proposal?: unknown,
  ): Promise<MaterializedProposal> {
    await this.authorize(projectId, userId);
    const { campaign } = await this.load(projectId, campaignId);
    const context = await this.plannerContext(campaign);
    return materializeProposal(context, this.normalizeProposal(proposal));
  }

  async planCampaign(command: PlanCampaignCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const { campaign, deliverables } = await this.load(projectId, campaignId);

    const plannedStatus = assertAction(campaign.status, "PLAN");
    const context = await this.plannerContext(campaign);
    const materialized = materializeProposal(
      context,
      this.normalizeProposal(command.proposal),
    );

    const now = this.deps.now();
    const addDeliverables = materialized.plan.deliverables.map((planned, index) =>
      this.deliverableFromPlan(campaign, planned, index, userId, now),
    );

    const result = await this.deps.repository.setStrategy({
      ...this.base(
        campaign,
        command.expectedRevisionNumber ?? campaign.revisionNumber,
        "PLAN_SET",
        userId,
        now,
        {
          material: true,
          lifecycle: { status: plannedStatus },
          payload: { deliverables: addDeliverables.length },
        },
      ),
      strategy: materialized.strategy,
      plan: materialized.plan,
      addDeliverables,
      removeDeliverableIds: deliverables.map((deliverable) => deliverable.id),
    });

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async addDeliverable(command: AddDeliverableCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const { campaign, deliverables } = await this.load(projectId, campaignId);

    assertAction(campaign.status, "EDIT");
    ensureDeliverableCount(deliverables.length);

    const grounding = await this.deps.grounding.gather(projectId);
    const format = resolveFormat({
      platformId: command.platformId,
      channel: command.channel,
      contentTypeId: command.contentTypeId,
      projectPlatforms: grounding.projectPlatforms,
    });
    const brief = validateDeliverableBrief(command.brief);
    const links = await this.verifiedLinks(projectId, this.parseLinks(command.links));

    const now = this.deps.now();
    const deliverable: NewDeliverableInput = {
      id: this.deps.newId("deliverable"),
      campaignId,
      projectId,
      title: requireText(command.title, "Deliverable title", 200),
      channel: format.channel,
      platformId: format.platformId,
      contentTypeId: format.contentTypeId,
      brief,
      links,
      position: nextPosition(deliverables),
      status: "PLANNED",
      scheduledFor: command.scheduledFor
        ? assertSchedulable(command.scheduledFor, campaign.brief)
        : null,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.deps.repository.addDeliverable({
      ...this.base(campaign, command.expectedRevisionNumber, "DELIVERABLE_ADDED", userId, now, {
        material: true,
        payload: { deliverableId: deliverable.id },
      }),
      deliverable,
    } as AddDeliverableInput);

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async updateDeliverable(command: UpdateDeliverableCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId, deliverableId } = command;
    await this.authorize(projectId, userId);
    const { campaign, deliverables } = await this.load(projectId, campaignId);
    assertAction(campaign.status, "EDIT");

    const existing = deliverables.find((row) => row.id === deliverableId);
    if (!existing) {
      throw new CampaignError("CAMPAIGN_DELIVERABLE_NOT_FOUND", "Deliverable not found", {
        deliverableId,
      });
    }

    const patch: DeliverablePatch = {};

    if (command.patch.title !== undefined) {
      patch.title = requireText(command.patch.title, "Deliverable title", 200);
    }
    if (command.patch.brief !== undefined) {
      patch.brief = validateDeliverableBrief(command.patch.brief);
    }
    if (command.patch.status !== undefined) {
      patch.status = parseDeliverableStatus(command.patch.status);
    }
    if (
      command.patch.platformId !== undefined ||
      command.patch.channel !== undefined ||
      command.patch.contentTypeId !== undefined
    ) {
      const grounding = await this.deps.grounding.gather(projectId);
      const format = resolveFormat({
        platformId: command.patch.platformId ?? existing.platformId,
        channel: command.patch.channel ?? existing.channel,
        contentTypeId: command.patch.contentTypeId ?? undefined,
        projectPlatforms: grounding.projectPlatforms,
      });
      patch.channel = format.channel;
      patch.platformId = format.platformId;
      patch.contentTypeId = format.contentTypeId;
    }
    if (command.patch.links !== undefined) {
      patch.links = await this.verifiedLinks(projectId, await this.parseLinks(command.patch.links));
    }
    if (command.patch.scheduledFor !== undefined) {
      patch.scheduledFor = command.patch.scheduledFor
        ? assertSchedulable(command.patch.scheduledFor, campaign.brief)
        : null;
    }

    if (Object.keys(patch).length === 0) {
      return this.load(projectId, campaignId);
    }

    const now = this.deps.now();
    const result = await this.deps.repository.updateDeliverable({
      ...this.base(campaign, command.expectedRevisionNumber, "DELIVERABLE_UPDATED", userId, now, {
        material: true,
        payload: { deliverableId, fields: Object.keys(patch) },
      }),
      deliverableId,
      patch,
    } as UpdateDeliverableInput);

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async removeDeliverable(command: RemoveDeliverableCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId, deliverableId } = command;
    await this.authorize(projectId, userId);
    const { campaign, deliverables } = await this.load(projectId, campaignId);
    assertAction(campaign.status, "EDIT");

    if (!deliverables.some((row) => row.id === deliverableId)) {
      throw new CampaignError("CAMPAIGN_DELIVERABLE_NOT_FOUND", "Deliverable not found", {
        deliverableId,
      });
    }

    const now = this.deps.now();
    const result = await this.deps.repository.removeDeliverable({
      ...this.base(campaign, command.expectedRevisionNumber, "DELIVERABLE_REMOVED", userId, now, {
        material: true,
        payload: { deliverableId },
      }),
      deliverableId,
    } as RemoveDeliverableInput);

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async schedule(command: ScheduleCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const { campaign, deliverables } = await this.load(projectId, campaignId);
    assertAction(campaign.status, "SCHEDULE");

    const known = new Set(deliverables.map((row) => row.id));
    const entries = command.entries.map((entry) => {
      if (!known.has(entry.deliverableId)) {
        throw new CampaignError("CAMPAIGN_DELIVERABLE_NOT_FOUND", "Deliverable not found", {
          deliverableId: entry.deliverableId,
        });
      }
      return {
        deliverableId: entry.deliverableId,
        scheduledFor: assertSchedulable(entry.scheduledFor, campaign.brief),
      };
    });

    const now = this.deps.now();
    const result = await this.deps.repository.setSchedule({
      ...this.base(campaign, command.expectedRevisionNumber, "SCHEDULED", userId, now, {
        material: true,
        payload: { count: entries.length },
      }),
      entries,
    } as SetScheduleInput);

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async submitForReview(command: TransitionCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);
    const status = assertAction(detail.campaign.status, "SUBMIT");

    const readiness = await this.computeReadiness(detail);
    this.assertReady(readiness, "submit for review");

    return this.commitLifecycle(command, detail.campaign, status, "SUBMITTED", {
      payload: { ready: true },
    });
  }

  async approveCampaign(command: TransitionCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);
    const approvedStatus = assertAction(detail.campaign.status, "APPROVE");

    const readiness = await this.computeReadiness(detail);
    this.assertReady(readiness, "approve");

    const approvalHash = this.approvalHash(detail);
    const now = this.deps.now();
    const lifecycle = {
      status: approvedStatus,
      approvalHash,
      approvedById: userId,
      approvedAt: now,
    };
    const result = await this.deps.repository.setLifecycle({
      ...this.base(detail.campaign, command.expectedRevisionNumber, "APPROVED", userId, now, {
        lifecycle,
        payload: { approvalHash },
      }),
      lifecycle,
    });

    this.assertApplied(result);
    return this.load(projectId, campaignId);
  }

  async returnToPlanning(command: TransitionCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);
    const status = assertAction(detail.campaign.status, "RETURN");

    return this.commitLifecycle(command, detail.campaign, status, "RETURNED", {
      lifecycle: {
        status,
        approvalHash: null,
        approvedById: null,
        approvedAt: null,
      },
      payload: {},
    });
  }

  async archiveCampaign(command: TransitionCommand): Promise<CampaignDetail> {
    const { userId, projectId, campaignId } = command;
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);
    const status = assertAction(detail.campaign.status, "ARCHIVE");

    return this.commitLifecycle(command, detail.campaign, status, "ARCHIVED", {
      payload: {},
    });
  }

  async readiness(userId: string, projectId: string, campaignId: string) {
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);
    return this.computeReadiness(detail);
  }

  async assemble(
    userId: string,
    projectId: string,
    campaignId: string,
  ): Promise<{ kit: LaunchKit; hash: string; campaign: CampaignRecord }> {
    await this.authorize(projectId, userId);
    const detail = await this.load(projectId, campaignId);

    if (detail.campaign.status !== "APPROVED") {
      throw new CampaignError(
        "CAMPAIGN_APPROVAL_REQUIRED",
        "Only an approved campaign can be assembled into a launch kit",
        { status: detail.campaign.status },
      );
    }

    const readiness = await this.computeReadiness(detail);
    this.assertReady(readiness, "assemble");

    const copy = new Map<string, LaunchKitCopy | null>();
    const assets = new Map<string, LaunchKitAsset[]>();
    for (const deliverable of detail.deliverables) {
      const documentId =
        deliverable.links.writingDocumentId ?? deliverable.links.editorDocumentId;
      if (documentId) {
        const resolved = await this.deps.artifacts.copy(projectId, documentId);
        copy.set(deliverable.id, resolved ? { documentId, ...resolved } : null);
      } else {
        copy.set(deliverable.id, null);
      }
      assets.set(
        deliverable.id,
        await this.deps.artifacts.assets(projectId, deliverable.links.assetIds),
      );
    }

    const assembledAt = this.deps.now();
    const { kit, hash } = buildLaunchKit({
      campaign: detail.campaign,
      deliverables: detail.deliverables,
      readiness,
      copy,
      assets,
      assembledAt,
    });

    const result = await this.deps.repository.setAssembly({
      ...this.base(detail.campaign, detail.campaign.revisionNumber, "ASSEMBLED", userId, assembledAt, {
        payload: { hash },
      }),
      launchKit: JSON.stringify(kit),
      launchKitHash: hash,
      assembledAt,
    });

    if (!result.applied || !result.campaign) {
      throw new CampaignError(
        "CAMPAIGN_REVISION_CONFLICT",
        "Campaign changed while the launch kit was assembled",
        { campaignId, actualRevisionNumber: result.campaign?.revisionNumber ?? null },
      );
    }

    return { kit, hash, campaign: result.campaign };
  }

  async exportLaunchKit(
    userId: string,
    projectId: string,
    campaignId: string,
  ): Promise<Record<string, unknown>> {
    await this.authorize(projectId, userId);
    const assembled = await this.deps.repository.getAssembledKit(projectId, campaignId);
    if (!assembled) {
      throw new CampaignError(
        "CAMPAIGN_LAUNCH_KIT_NOT_ASSEMBLED",
        "Campaign has no assembled launch kit",
        { campaignId },
      );
    }
    return toExportDocument(assembled.kit);
  }

  async history(
    userId: string,
    projectId: string,
    campaignId: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; revisions: CampaignRevisionRecord[] }> {
    await this.authorize(projectId, userId);
    const campaign = await this.deps.repository.getCampaign(projectId, campaignId);
    if (!campaign) {
      throw new CampaignError("CAMPAIGN_NOT_FOUND", "Campaign not found", { campaignId });
    }
    const total = await this.deps.repository.countRevisions(campaignId);
    const revisions = await this.deps.repository.listRevisions({ campaignId, limit, offset });
    return { total, revisions };
  }

  // -------------------------------------------------------------------------

  private async commitLifecycle(
    command: TransitionCommand,
    campaign: CampaignRecord,
    status: CampaignStatus,
    kind: CampaignRevisionKind,
    options: { lifecycle?: SetLifecycleInput["lifecycle"]; payload?: Record<string, unknown> },
  ): Promise<CampaignDetail> {
    const now = this.deps.now();
    const lifecycle = options.lifecycle ?? { status };
    const result = await this.deps.repository.setLifecycle({
      ...this.base(campaign, command.expectedRevisionNumber, kind, userId_(command), now, {
        lifecycle,
        payload: options.payload ?? {},
      }),
      lifecycle,
    });

    this.assertApplied(result);
    return this.load(command.projectId, command.campaignId);
  }

  private async load(projectId: string, campaignId: string): Promise<CampaignDetail> {
    const campaign = await this.deps.repository.getCampaign(projectId, campaignId);
    if (!campaign) {
      throw new CampaignError("CAMPAIGN_NOT_FOUND", "Campaign not found", { campaignId });
    }
    const deliverables = await this.deps.repository.listDeliverables(campaignId);
    return { campaign, deliverables };
  }

  private async authorize(projectId: string, userId: string): Promise<void> {
    await this.deps.authorizeProject(projectId, userId);
  }

  private async plannerContext(campaign: CampaignRecord): Promise<PlannerContext> {
    const grounding = await this.deps.grounding.gather(campaign.projectId);
    return {
      campaignName: campaign.name,
      objective: campaign.objective,
      audienceSummary: campaign.audienceSummary,
      keyMessage: campaign.keyMessage,
      tone: campaign.brief.tone,
      launchWindow: campaign.brief.launchWindow,
      projectPlatforms: grounding.projectPlatforms,
      grounding: {
        sourceIds: dedupe([...campaign.brief.sourceIds, ...grounding.sourceIds]),
        intelligenceVersion: grounding.intelligenceVersion,
        brandVersion: grounding.brandVersion,
      },
      newId: this.deps.newId,
      now: this.deps.now,
    };
  }

  private normalizeProposal(proposal: unknown): CampaignProposal | undefined {
    if (proposal === undefined || proposal === null) {
      return undefined;
    }
    if (typeof proposal !== "object" || Array.isArray(proposal)) {
      throw new CampaignError("CAMPAIGN_INVALID_INPUT", "Proposal must be an object");
    }
    const value = proposal as Record<string, unknown>;
    const source: CampaignPlannerSource =
      value["source"] === "AI" ? "AI" : "DETERMINISTIC";
    return {
      source,
      positioning: String(value["positioning"] ?? ""),
      keyMessage: String(value["keyMessage"] ?? ""),
      tone: String(value["tone"] ?? ""),
      narrative: asArray(value["narrative"]) as CampaignProposal["narrative"],
      phases: asArray(value["phases"]) as CampaignProposal["phases"],
      platformIds: asArray(value["platformIds"]).map(String),
      deliverables: asArray(value["deliverables"]) as CampaignProposal["deliverables"],
      groundedInSourceIds: asArray(value["groundedInSourceIds"]).map(String),
    };
  }

  private deliverableFromPlan(
    campaign: CampaignRecord,
    planned: { title: string; channel: string; platformId: string; contentTypeId: string; objective: string; keyMessage: string; phaseId: string | null },
    index: number,
    userId: string,
    now: string,
  ): NewDeliverableInput {
    return {
      id: this.deps.newId("deliverable"),
      campaignId: campaign.id,
      projectId: campaign.projectId,
      title: planned.title,
      channel: planned.channel as NewDeliverableInput["channel"],
      platformId: planned.platformId,
      contentTypeId: planned.contentTypeId,
      brief: {
        objective: planned.objective,
        keyMessage: planned.keyMessage,
        notes: null,
        phaseId: planned.phaseId,
      },
      links: emptyDeliverableLinks(),
      position: index,
      status: "PLANNED",
      scheduledFor: null,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async computeReadiness(detail: CampaignDetail) {
    const { campaign, deliverables } = detail;
    const grounding = await this.deps.grounding.gather(campaign.projectId);
    const available = new Set(grounding.sourceIds);
    const declared = dedupe([
      ...campaign.brief.sourceIds,
      ...(campaign.strategy?.groundedIn.sourceIds ?? []),
    ]);

    const links: LinkResolution[] = await Promise.all(
      deliverables.map(async (deliverable) => {
        const missing: { kind: string; id: string }[] = [];
        const crossProject: { kind: string; id: string }[] = [];
        for (const [kind, id] of linkSlots(deliverable.links)) {
          if (!id) continue;
          const status = await this.deps.artifacts.locate(
            campaign.projectId,
            kind as ArtifactKind,
            id,
          );
          if (status === "MISSING") missing.push({ kind, id });
          if (status === "FOREIGN") crossProject.push({ kind, id });
        }
        const resolvedAssets = await this.deps.artifacts.assets(
          campaign.projectId,
          deliverable.links.assetIds,
        );
        return {
          deliverableId: deliverable.id,
          missing,
          crossProject,
          requiredAssets: deliverable.links.assetIds.length,
          readyAssets: resolvedAssets.length,
        };
      }),
    );

    return evaluateReadiness({
      campaign,
      deliverables,
      grounding: {
        missingSourceIds: declared.filter((id) => !available.has(id)),
      },
      links,
    });
  }

  private approvalHash(detail: CampaignDetail): string {
    const { campaign, deliverables } = detail;
    return campaignHash({
      name: campaign.name,
      objective: campaign.objective,
      audienceSummary: campaign.audienceSummary,
      keyMessage: campaign.keyMessage,
      brief: campaign.brief,
      strategy: campaign.strategy,
      plan: campaign.plan,
      deliverables: orderDeliverables(deliverables).map((deliverable) => ({
        id: deliverable.id,
        title: deliverable.title,
        channel: deliverable.channel,
        platformId: deliverable.platformId,
        contentTypeId: deliverable.contentTypeId,
        brief: deliverable.brief,
        links: deliverable.links,
        position: deliverable.position,
        scheduledFor: deliverable.scheduledFor,
        status: deliverable.status,
      })),
    });
  }

  private assertReady(readiness: { ready: boolean; checks: { severity: string }[] }, action: string): void {
    if (!readiness.ready) {
      throw new CampaignError(
        "CAMPAIGN_NOT_READY",
        `Campaign has blocking issues and cannot ${action}`,
        { checks: readiness.checks },
      );
    }
  }

  private assertSourcesExist(declared: string[], available: string[]): void {
    const known = new Set(available);
    const missing = declared.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new CampaignError(
        "CAMPAIGN_GROUNDING_MISSING",
        "Campaign cites sources the project does not have",
        { missingSourceIds: missing },
      );
    }
  }

  private parseLinks(raw: unknown): DeliverableLinks {
    if (raw === undefined || raw === null) return emptyDeliverableLinks();
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new CampaignError("CAMPAIGN_INVALID_INPUT", "Links must be an object");
    }
    const value = raw as Record<string, unknown>;
    const optional = (key: string): string | null => {
      const entry = value[key];
      if (entry === undefined || entry === null) return null;
      const trimmed = String(entry).trim();
      return trimmed.length === 0 ? null : trimmed;
    };
    const list = (key: string): string[] => {
      const entry = value[key];
      if (entry === undefined || entry === null) return [];
      if (!Array.isArray(entry)) {
        throw new CampaignError("CAMPAIGN_INVALID_INPUT", `${key} must be a list`);
      }
      return entry.map(String).filter((id) => id.length > 0);
    };
    return {
      intentId: optional("intentId"),
      writingDocumentId: optional("writingDocumentId"),
      adaptationBatchId: optional("adaptationBatchId"),
      editorDocumentId: optional("editorDocumentId"),
      graphicDocumentId: optional("graphicDocumentId"),
      assetIds: list("assetIds"),
      sourceIds: list("sourceIds"),
    };
  }

  private async verifyLinks(projectId: string, links: DeliverableLinks): Promise<DeliverableLinks> {
    for (const [kind, id] of linkSlots(links)) {
      if (!id) continue;
      const status = await this.deps.artifacts.locate(projectId, kind as ArtifactKind, id);
      if (status === "FOREIGN") {
        throw new CampaignError(
          "CAMPAIGN_CROSS_PROJECT_ARTIFACT",
          "Deliverable links an artifact from another project",
          { kind, id },
        );
      }
    }
    return links;
  }

  private async verifiedLinks(projectId: string, links: DeliverableLinks) {
    return this.verifyLinks(projectId, links);
  }

  private base(
    campaign: CampaignRecord,
    expectedRevisionNumber: number,
    kind: CampaignRevisionKind,
    userId: string,
    now: string,
    options: {
      material?: boolean;
      lifecycle?: CampaignMutationBase["lifecycle"];
      payload?: Record<string, unknown>;
    },
  ): CampaignMutationBase {
    const material = options.material === true;
    const dropsApproval = material && campaign.status === "APPROVED";
    const lifecycle =
      options.lifecycle ??
      (dropsApproval
        ? { status: "PLANNED", approvalHash: null, approvedById: null, approvedAt: null }
        : undefined);

    return {
      projectId: campaign.projectId,
      campaignId: campaign.id,
      expectedRevisionNumber,
      now,
      revision: {
        revisionId: this.deps.newId("campaignrev"),
        campaignId: campaign.id,
        revisionNumber: expectedRevisionNumber + 1,
        kind,
        payload: options.payload ?? {},
        createdById: userId,
        createdAt: now,
      },
      lifecycle,
      resetAssembly: dropsApproval,
    };
  }

  private assertApplied(result: CampaignMutationResult): CampaignRecord {
    if (!result.applied) {
      throw new CampaignError(
        "CAMPAIGN_REVISION_CONFLICT",
        "Campaign was modified by someone else",
        { actualRevisionNumber: result.campaign?.revisionNumber ?? null },
      );
    }
    if (!result.campaign) {
      throw new Error("Campaign mutation returned no campaign");
    }
    return result.campaign;
  }
}

function userId_(command: TransitionCommand): string {
  return command.userId;
}

function linkSlots(links: DeliverableLinks): [string, string | null][] {
  return [
    ["intent", links.intentId],
    ["writing", links.writingDocumentId],
    ["adaptation", links.adaptationBatchId],
    ["editor", links.editorDocumentId],
    ["graphic", links.graphicDocumentId],
  ];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateHeadlinePartial(patch: {
  name?: string;
  objective?: string;
  audienceSummary?: string;
  keyMessage?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (patch.name !== undefined) out["name"] = requireText(patch.name, "Campaign name", 160);
  if (patch.objective !== undefined) out["objective"] = requireText(patch.objective, "Objective", 2_000);
  if (patch.audienceSummary !== undefined) {
    out["audienceSummary"] = requireText(patch.audienceSummary, "Audience", 2_000);
  }
  if (patch.keyMessage !== undefined) out["keyMessage"] = requireText(patch.keyMessage, "Key message", 2_000);
  return out;
}

function requireText(value: string, label: string, max: number): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new CampaignError("CAMPAIGN_INVALID_INPUT", `${label} is required`);
  if (trimmed.length > max) {
    throw new CampaignError("CAMPAIGN_INVALID_INPUT", `${label} must be at most ${max} characters`);
  }
  return trimmed;
}

function parseDeliverableStatus(value: string): (typeof DELIVERABLE_STATUSES)[number] {
  if (!(DELIVERABLE_STATUSES as readonly string[]).includes(value)) {
    throw new CampaignError("CAMPAIGN_INVALID_INPUT", "Unknown deliverable status");
  }
  return value as (typeof DELIVERABLE_STATUSES)[number];
}

function nextPosition(deliverables: readonly { position: number }[]): number {
  return deliverables.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
