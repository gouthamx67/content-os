import type { ContentChannel } from "../domain/content-type";
import type {
  CampaignBrief,
  CampaignDeliverableRecord,
  CampaignDeliverableStatus,
  CampaignPlan,
  CampaignRecord,
  CampaignRevisionKind,
  CampaignRevisionRecord,
  CampaignStatus,
  DeliverableBrief,
  DeliverableLinks,
  LaunchKit,
  LaunchStrategy,
} from "../../modules/campaign-engine/domain/types";

export type AssembledKit = {
  kit: LaunchKit;
  hash: string;
};

export type CampaignRevisionInput = {
  revisionId: string;
  campaignId: string;
  revisionNumber: number;
  kind: CampaignRevisionKind;
  payload: Record<string, unknown>;
  createdById: string;
  createdAt: string;
};

export type NewDeliverableInput = {
  id: string;
  campaignId: string;
  projectId: string;
  title: string;
  channel: ContentChannel;
  platformId: string;
  contentTypeId: string;
  brief: DeliverableBrief;
  links: DeliverableLinks;
  position: number;
  status: CampaignDeliverableStatus;
  scheduledFor: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCampaignInput = {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
  brief: CampaignBrief;
  status: CampaignStatus;
  createdById: string;
  now: string;
  firstRevision: CampaignRevisionInput;
  deliverables: readonly NewDeliverableInput[];
};

/**
 * Lifecycle columns a mutation may set alongside its own change.
 *
 * A material edit to an approved campaign must drop the approval in the same
 * write that changes the content, otherwise a reader could observe "approved"
 * over content nobody approved. Carrying the columns on every mutation lets the
 * service fold that invalidation into the one transaction.
 */
export type CampaignLifecycleColumns = {
  status?: CampaignStatus;
  approvalHash?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
};

/**
 * Every mutation names the revision the caller started from and carries the
 * revision row that records what it did. The two travel together so a mutation
 * cannot move the head without leaving a trace, and a stale caller cannot
 * half-apply.
 */
export type CampaignMutationBase = {
  projectId: string;
  campaignId: string;
  expectedRevisionNumber: number;
  now: string;
  revision: CampaignRevisionInput;
  lifecycle?: CampaignLifecycleColumns;
  /**
   * True when the change makes an assembled Launch Kit stale, so its stored copy
   * and hash are cleared in the same write. Content and the kit it produced must
   * not be able to disagree.
   */
  resetAssembly?: boolean;
};

export type CampaignMutationResult = {
  /** False when another writer moved the head first; nothing was written. */
  applied: boolean;
  /** The campaign as it actually is after the attempt, for reporting a conflict. */
  campaign: CampaignRecord | null;
};

export type CampaignHeadlinePatch = {
  name?: string;
  objective?: string;
  audienceSummary?: string;
  keyMessage?: string;
  brief?: CampaignBrief;
};

export type DeliverablePatch = {
  title?: string;
  channel?: ContentChannel;
  platformId?: string;
  contentTypeId?: string;
  brief?: DeliverableBrief;
  links?: DeliverableLinks;
  status?: CampaignDeliverableStatus;
  scheduledFor?: string | null;
};

export type SetStrategyInput = CampaignMutationBase & {
  strategy: LaunchStrategy;
  plan: CampaignPlan;
  /** Deliverables that the accepted plan materialised. */
  addDeliverables: readonly NewDeliverableInput[];
  /** Deliverables the previous plan owned and the new one does not. */
  removeDeliverableIds: readonly string[];
};

export type SetBriefInput = CampaignMutationBase & {
  patch: CampaignHeadlinePatch;
};

export type AddDeliverableInput = CampaignMutationBase & {
  deliverable: NewDeliverableInput;
};

export type UpdateDeliverableInput = CampaignMutationBase & {
  deliverableId: string;
  patch: DeliverablePatch;
};

export type RemoveDeliverableInput = CampaignMutationBase & {
  deliverableId: string;
};

export type SetScheduleInput = CampaignMutationBase & {
  entries: readonly { deliverableId: string; scheduledFor: string }[];
};

export type SetLifecycleInput = CampaignMutationBase & {
  lifecycle: CampaignLifecycleColumns;
};

export type SetAssemblyInput = CampaignMutationBase & {
  launchKit: string;
  launchKitHash: string;
  assembledAt: string;
};

export type CampaignRevisionListFilter = {
  campaignId: string;
  limit: number;
  offset: number;
};

/**
 * Persistence for campaigns.
 *
 * Reads are scoped by project and id together; a campaign id from another project
 * simply does not resolve. Writes are optimistic: they carry the expected
 * revision number and the revision row to append, so a stale write is refused
 * rather than merged.
 */
export type CampaignRepository = {
  createCampaign(input: CreateCampaignInput): Promise<CampaignRecord>;

  getCampaign(
    projectId: string,
    campaignId: string,
  ): Promise<CampaignRecord | null>;

  listCampaigns(projectId: string): Promise<CampaignRecord[]>;

  getDeliverable(
    campaignId: string,
    deliverableId: string,
  ): Promise<CampaignDeliverableRecord | null>;

  /** Project-scoped deliverable read; null when it lives in another project. */
  getDeliverableForProject(
    projectId: string,
    deliverableId: string,
  ): Promise<CampaignDeliverableRecord | null>;

  listDeliverables(campaignId: string): Promise<CampaignDeliverableRecord[]>;

  listRevisions(
    filter: CampaignRevisionListFilter,
  ): Promise<CampaignRevisionRecord[]>;

  countRevisions(campaignId: string): Promise<number>;

  /** The assembled Launch Kit as it was frozen, or null if never assembled. */
  getAssembledKit(
    projectId: string,
    campaignId: string,
  ): Promise<AssembledKit | null>;

  setStrategy(input: SetStrategyInput): Promise<CampaignMutationResult>;

  setBrief(input: SetBriefInput): Promise<CampaignMutationResult>;

  addDeliverable(input: AddDeliverableInput): Promise<CampaignMutationResult>;

  updateDeliverable(
    input: UpdateDeliverableInput,
  ): Promise<CampaignMutationResult>;

  removeDeliverable(
    input: RemoveDeliverableInput,
  ): Promise<CampaignMutationResult>;

  setSchedule(input: SetScheduleInput): Promise<CampaignMutationResult>;

  setLifecycle(input: SetLifecycleInput): Promise<CampaignMutationResult>;

  setAssembly(input: SetAssemblyInput): Promise<CampaignMutationResult>;
};
