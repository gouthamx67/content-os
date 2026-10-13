import type { ContentChannel } from "../../../core/domain/content-type";

/**
 * The campaign lifecycle.
 *
 * `DRAFT` is a brief nobody has planned yet; `PLANNED` has a strategy and a
 * structure; `IN_REVIEW` is submitted for approval; `APPROVED` has been signed
 * off against a frozen hash; `ARCHIVED` is done. Nothing transitions implicitly:
 * every move is a service call that checks the current state first.
 */
export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "PLANNED",
  "IN_REVIEW",
  "APPROVED",
  "ARCHIVED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * A deliverable is planned, worked on, ready, or explicitly blocked. `READY` is
 * the only state that satisfies the readiness validator; `BLOCKED` carries a
 * reason so the plan can explain itself instead of simply refusing to advance.
 */
export const CAMPAIGN_DELIVERABLE_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "READY",
  "BLOCKED",
] as const;
export type CampaignDeliverableStatus =
  (typeof CAMPAIGN_DELIVERABLE_STATUSES)[number];

export const CAMPAIGN_REVISION_KINDS = [
  "CREATE",
  "BRIEF_UPDATED",
  "STRATEGY_SET",
  "PLAN_SET",
  "DELIVERABLE_ADDED",
  "DELIVERABLE_UPDATED",
  "DELIVERABLE_REMOVED",
  "SUBMITTED",
  "APPROVED",
  "RETURNED",
  "SCHEDULED",
  "ASSEMBLED",
  "ARCHIVED",
] as const;
export type CampaignRevisionKind = (typeof CAMPAIGN_REVISION_KINDS)[number];

export const CAMPAIGN_TONES = [
  "BRAND",
  "PROFESSIONAL",
  "FRIENDLY",
  "PLAYFUL",
  "BOLD",
  "MINIMAL",
  "TECHNICAL",
  "CONVERSATIONAL",
] as const;
export type CampaignTone = (typeof CAMPAIGN_TONES)[number];

export const CAMPAIGN_PLANNER_SOURCES = ["DETERMINISTIC", "AI"] as const;
export type CampaignPlannerSource = (typeof CAMPAIGN_PLANNER_SOURCES)[number];

/** A launch window is inclusive of both days and always in UTC. */
export type CampaignLaunchWindow = {
  start: string;
  end: string;
};

/**
 * The free-form half of the brief. The four headline fields a person reads first
 * live as columns; everything that can grow without changing the shape of a
 * campaign lives here.
 */
export type CampaignBrief = {
  tone: CampaignTone;
  constraints: string[];
  keyMessages: string[];
  successMetrics: string[];
  sourceIds: string[];
  launchWindow: CampaignLaunchWindow | null;
  notes: string | null;
};

export type StrategyPhase = {
  id: string;
  name: string;
  description: string;
  startOffsetDays: number;
  durationDays: number;
};

export type StrategyNarrative = {
  id: string;
  title: string;
  description: string;
};

/**
 * The strategy is the "why and when": a positioning statement, the narrative
 * beats, the phases of the launch, and the platform mix it commits to. It is
 * frozen once set so an approval's hash covers it.
 */
export type LaunchStrategy = {
  positioning: string;
  keyMessage: string;
  narrative: StrategyNarrative[];
  phases: StrategyPhase[];
  platformIds: string[];
  tone: CampaignTone;
  groundedIn: CampaignGrounding;
};

/**
 * What a plan proposes. `deliverables` are materialised as rows when the plan is
 * accepted; the plan itself is stored so approval and assembly can hash a stable
 * description of what was agreed.
 */
export type PlannedDeliverable = {
  key: string;
  title: string;
  channel: ContentChannel;
  platformId: string;
  contentTypeId: string;
  objective: string;
  keyMessage: string;
  phaseId: string | null;
};

export type CampaignPlan = {
  deliverables: PlannedDeliverable[];
  generatedAt: string;
  generatedBy: CampaignPlannerSource;
};

/** The per-deliverable creative brief, kept beside the deliverable's links. */
export type DeliverableBrief = {
  objective: string;
  keyMessage: string;
  notes: string | null;
  phaseId: string | null;
};

/**
 * References, not copies. Every id is validated against the owning project
 * before it is stored, and a stale reference is reported by readiness rather
 * than silently repaired.
 */
export type DeliverableLinks = {
  intentId: string | null;
  writingDocumentId: string | null;
  adaptationBatchId: string | null;
  editorDocumentId: string | null;
  graphicDocumentId: string | null;
  assetIds: string[];
  sourceIds: string[];
};

export function emptyDeliverableLinks(): DeliverableLinks {
  return {
    intentId: null,
    writingDocumentId: null,
    adaptationBatchId: null,
    editorDocumentId: null,
    graphicDocumentId: null,
    assetIds: [],
    sourceIds: [],
  };
}

/**
 * Where the campaign's grounding comes from.
 *
 * A campaign may state an opinion, but not invent one: every strategic claim has
 * to trace to a source or to a version of intelligence/brand the project
 * actually produced. The versions are recorded so a later change can be detected
 * rather than silently inherited.
 */
export type CampaignGrounding = {
  sourceIds: string[];
  intelligenceVersion: number | null;
  brandVersion: number | null;
};

export type CampaignRecord = {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
  brief: CampaignBrief;
  status: CampaignStatus;
  strategy: LaunchStrategy | null;
  plan: CampaignPlan | null;
  revisionNumber: number;
  approvalHash: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  launchKitHash: string | null;
  assembledAt: string | null;
  hasLaunchKit: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type CampaignDeliverableRecord = {
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

export type CampaignRevisionRecord = {
  id: string;
  campaignId: string;
  revisionNumber: number;
  kind: CampaignRevisionKind;
  payload: Record<string, unknown>;
  createdById: string;
  createdAt: string;
};

export type CampaignDetail = {
  campaign: CampaignRecord;
  deliverables: CampaignDeliverableRecord[];
};

export type ReadinessSeverity = "BLOCKING" | "WARNING" | "INFO";

export type CampaignEntityType = "CAMPAIGN" | "DELIVERABLE" | "PROJECT";

export type CampaignReadinessCheck = {
  code: string;
  severity: ReadinessSeverity;
  entity: { type: CampaignEntityType; id: string | null };
  message: string;
  remediation: string;
};

export type CampaignReadiness = {
  ready: boolean;
  checkedAt: string;
  checks: CampaignReadinessCheck[];
  summary: {
    blocking: number;
    warning: number;
    info: number;
  };
};

/** The resolved copy an assembled kit carries, not the raw storage key. */
export type LaunchKitCopy = {
  documentId: string;
  title: string;
  content: string;
};

export type LaunchKitAsset = {
  id: string;
  name: string;
  mimeType: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
};

export type LaunchKitDeliverable = {
  id: string;
  title: string;
  channel: ContentChannel;
  platformId: string;
  platformName: string;
  contentTypeId: string;
  status: CampaignDeliverableStatus;
  scheduledFor: string | null;
  brief: DeliverableBrief;
  links: DeliverableLinks;
  copy: LaunchKitCopy | null;
  assets: LaunchKitAsset[];
};

export type LaunchKit = {
  version: number;
  assembledAt: string;
  campaign: {
    id: string;
    projectId: string;
    name: string;
    objective: string;
    audienceSummary: string;
    keyMessage: string;
    status: CampaignStatus;
  };
  strategy: LaunchStrategy | null;
  deliverables: LaunchKitDeliverable[];
  grounding: CampaignGrounding;
  readiness: {
    ready: boolean;
    blocking: number;
    warning: number;
  };
};

export const CAMPAIGN_KIT_VERSION = 1;

export const CAMPAIGN_LIMITS = {
  maxNameLength: 160,
  maxObjectiveLength: 2_000,
  maxAudienceLength: 2_000,
  maxKeyMessageLength: 2_000,
  maxConstraintLength: 400,
  maxConstraints: 25,
  maxKeyMessages: 25,
  maxSuccessMetrics: 25,
  maxNotesLength: 4_000,
  maxDeliverables: 100,
  minDeliverableTitle: 1,
  maxDeliverableTitle: 200,
  maxStrategyText: 4_000,
  maxNarrativeBeats: 12,
  maxPhases: 12,
  maxPlatforms: 12,
  maxSources: 200,
} as const;
