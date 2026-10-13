import { getPlatform } from "../../core/domain/platform";
import { resolveFormat, throwFormatError } from "./domain/channels";
import { CAMPAIGN_LIMITS } from "./domain/types";
import type {
  CampaignGrounding,
  CampaignPlan,
  CampaignPlannerSource,
  LaunchStrategy,
  PlannedDeliverable,
  StrategyNarrative,
  StrategyPhase,
} from "./domain/types";
import { CAMPAIGN_TONES } from "./domain/types";

/**
 * Everything a planner is allowed to know. A proposal is judged against these
 * facts and nothing else, which is what keeps "the AI proposed it" from being an
 * excuse for a claim the project cannot support.
 */
export type PlannerContext = {
  campaignName: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
  tone: string;
  launchWindow: { start: string; end: string } | null;
  projectPlatforms: string[];
  grounding: CampaignGrounding;
  newId: (prefix: string) => string;
  now: () => string;
};

export type ProposedDeliverable = {
  key: string;
  title: string;
  platformId: string;
  channel?: string | null;
  contentTypeId?: string | null;
  phaseIndex: number | null;
  objective: string;
  keyMessage: string;
};

export type CampaignProposal = {
  source: CampaignPlannerSource;
  positioning: string;
  keyMessage: string;
  tone: string;
  narrative: { title: string; description: string }[];
  phases: { name: string; description: string; startOffsetDays: number; durationDays: number }[];
  platformIds: string[];
  deliverables: ProposedDeliverable[];
  groundedInSourceIds: string[];
};

export type MaterializedProposal = {
  strategy: LaunchStrategy;
  plan: CampaignPlan;
};

/**
 * Turns a proposal into the stored strategy and plan, or refuses it.
 *
 * Every check here is structural. The planner does not ask "is this a good
 * idea"; it asks whether the ids resolve, whether the phases line up with the
 * window, and whether the proposal can be represented at all. A proposal that
 * fails is rejected as a whole so the campaign is never half-planned.
 */
export function materializeProposal(
  context: PlannerContext,
  proposal: CampaignProposal | undefined,
): MaterializedProposal {
  const resolved = proposal ?? createDeterministicProposal(context);

  if (resolved.source === "AI" && resolved.groundedInSourceIds.length === 0) {
    throwFormatError(
      "CAMPAIGN_UNSUPPORTED_CLAIM",
      "An AI proposal must cite at least one grounding source",
    );
  }

  const positioning = requireText(resolved.positioning, "Positioning", CAMPAIGN_LIMITS.maxStrategyText);
  const keyMessage = requireText(resolved.keyMessage, "Key message", CAMPAIGN_LIMITS.maxKeyMessageLength);
  const tone = isTone(resolved.tone) ? resolved.tone : requireTone(context.tone);

  const phases = normalizePhases(resolved.phases, context.launchWindow);
  const narrative = normalizeNarrative(resolved.narrative, context);

  const platformIds = normalizePlatforms(
    resolved.platformIds,
    context.projectPlatforms,
  );

  const deliverables = normalizeDeliverables(
    context,
    resolved.deliverables,
    phases,
    platformIds,
  );

  const groundedIn: CampaignGrounding = {
    sourceIds: dedupe([
      ...resolved.groundedInSourceIds,
      ...context.grounding.sourceIds,
    ]),
    intelligenceVersion: context.grounding.intelligenceVersion,
    brandVersion: context.grounding.brandVersion,
  };

  const strategy: LaunchStrategy = {
    positioning,
    keyMessage,
    narrative,
    phases,
    platformIds,
    tone,
    groundedIn,
  };

  const plan: CampaignPlan = {
    deliverables,
    generatedAt: context.now(),
    generatedBy: resolved.source,
  };

  return { strategy, plan };
}

export function createDeterministicProposal(
  context: PlannerContext,
): CampaignProposal {
  const platformIds = normalizePlatforms([], context.projectPlatforms).slice(
    0,
    3,
  );
  const phases = defaultPhases(context.launchWindow);

  const deliverables: ProposedDeliverable[] = [];
  platformIds.forEach((platformId) => {
    const channel = defaultChannelFor(platformId);
    const format = resolveFormat({
      platformId,
      channel,
      projectPlatforms: context.projectPlatforms,
    });
    phases.forEach((phase, phaseIndex) => {
      deliverables.push({
        key: `${platformId}_${phaseIndex}`,
        title: `${phase.name} — ${platformName(platformId)}`,
        platformId,
        channel: format.channel,
        contentTypeId: format.contentTypeId,
        phaseIndex,
        objective: context.objective,
        keyMessage: context.keyMessage,
      });
    });
  });

  return {
    source: "DETERMINISTIC",
    positioning: `${context.campaignName} reaches ${context.audienceSummary}`,
    keyMessage: context.keyMessage,
    tone: context.tone,
    narrative: [
      {
        title: "Hook",
        description: `Lead with the promise: ${context.keyMessage}`,
      },
      {
        title: "Proof",
        description: `Show why it is true for ${context.audienceSummary}`,
      },
      {
        title: "Invitation",
        description: `Ask ${context.audienceSummary} to act on ${context.objective}`,
      },
    ],
    phases: phases.map((phase) => ({
      name: phase.name,
      description: phase.description,
      startOffsetDays: phase.startOffsetDays,
      durationDays: phase.durationDays,
    })),
    platformIds,
    deliverables,
    groundedInSourceIds: context.grounding.sourceIds,
  };
}

function normalizePlatforms(
  requested: readonly string[],
  projectPlatforms: readonly string[],
): string[] {
  const base =
    requested.length > 0
      ? requested
      : projectPlatforms.length > 0
        ? projectPlatforms
        : ["instagram", "linkedin", "youtube"];

  const out: string[] = [];
  for (const id of base) {
    if (!getPlatform(id)) {
      throwFormatError("CAMPAIGN_PLATFORM_UNKNOWN", `Unknown platform: ${id}`);
    }
    if (projectPlatforms.length > 0 && !projectPlatforms.includes(id)) {
      throwFormatError(
        "CAMPAIGN_PLATFORM_NOT_IN_PROJECT",
        `${platformName(id)} is not one of this project's platforms`,
      );
    }
    if (!out.includes(id)) out.push(id);
  }

  if (out.length === 0) {
    throwFormatError(
      "CAMPAIGN_PLATFORM_UNKNOWN",
      "A plan needs at least one platform",
    );
  }
  if (out.length > CAMPAIGN_LIMITS.maxPlatforms) {
    throwFormatError(
      "CAMPAIGN_INVALID_INPUT",
      `A plan may target at most ${CAMPAIGN_LIMITS.maxPlatforms} platforms`,
    );
  }
  return out;
}

function normalizePhases(
  phases: readonly { name: string; description: string; startOffsetDays: number; durationDays: number }[],
  window: { start: string; end: string } | null,
): StrategyPhase[] {
  const source = phases.length > 0 ? phases : defaultPhases(window);
  if (source.length > CAMPAIGN_LIMITS.maxPhases) {
    throwFormatError(
      "CAMPAIGN_INVALID_INPUT",
      `A strategy may hold at most ${CAMPAIGN_LIMITS.maxPhases} phases`,
    );
  }
  return source.map((phase, index) => {
    const name = requireText(phase.name, "Phase name", 120);
    const description = typeof phase.description === "string" ? phase.description.trim() : "";
    const startOffsetDays = Math.max(0, Math.floor(Number(phase.startOffsetDays) || 0));
    const durationDays = Math.max(1, Math.floor(Number(phase.durationDays) || 1));
    return {
      id: `phase_${index + 1}`,
      name,
      description,
      startOffsetDays,
      durationDays,
    };
  });
}

function normalizeNarrative(
  narrative: readonly { title: string; description: string }[],
  context: PlannerContext,
): StrategyNarrative[] {
  const source =
    narrative.length > 0
      ? narrative
      : [{ title: "Launch", description: context.keyMessage }];
  if (source.length > CAMPAIGN_LIMITS.maxNarrativeBeats) {
    throwFormatError(
      "CAMPAIGN_INVALID_INPUT",
      `A strategy may hold at most ${CAMPAIGN_LIMITS.maxNarrativeBeats} narrative beats`,
    );
  }
  return source.map((beat, index) => ({
    id: `beat_${index + 1}`,
    title: requireText(beat.title, "Narrative title", 120),
    description: typeof beat.description === "string" ? beat.description.trim() : "",
  }));
}

function normalizeDeliverables(
  context: PlannerContext,
  deliverables: readonly ProposedDeliverable[],
  phases: readonly StrategyPhase[],
  platformIds: readonly string[],
): PlannedDeliverable[] {
  if (deliverables.length === 0) {
    throwFormatError(
      "CAMPAIGN_PLAN_REQUIRED",
      "A plan needs at least one deliverable",
    );
  }
  if (deliverables.length > CAMPAIGN_LIMITS.maxDeliverables) {
    throwFormatError(
      "CAMPAIGN_DELIVERABLE_LIMIT_EXCEEDED",
      `A plan may hold at most ${CAMPAIGN_LIMITS.maxDeliverables} deliverables`,
    );
  }

  const out: PlannedDeliverable[] = [];
  for (const deliverable of deliverables) {
    if (!platformIds.includes(deliverable.platformId)) {
      throwFormatError(
        "CAMPAIGN_PLATFORM_NOT_IN_PROJECT",
        `Deliverable targets a platform outside the plan: ${deliverable.platformId}`,
      );
    }

    const format = resolveFormat({
      platformId: deliverable.platformId,
      channel: deliverable.channel ?? null,
      contentTypeId: deliverable.contentTypeId ?? null,
      projectPlatforms: context.projectPlatforms,
    });

    const phaseId =
      deliverable.phaseIndex === null
        ? null
        : phases[deliverable.phaseIndex]?.id ?? null;

    out.push({
      key: deliverable.key || context.newId("deliverable"),
      title: requireText(
        deliverable.title,
        "Deliverable title",
        CAMPAIGN_LIMITS.maxDeliverableTitle,
      ),
      channel: format.channel,
      platformId: format.platformId,
      contentTypeId: format.contentTypeId,
      objective: typeof deliverable.objective === "string" ? deliverable.objective.trim() : context.objective,
      keyMessage: typeof deliverable.keyMessage === "string" ? deliverable.keyMessage.trim() : context.keyMessage,
      phaseId,
    });
  }

  return out;
}

function defaultPhases(
  window: { start: string; end: string } | null,
): StrategyPhase[] {
  if (!window) {
    return [
      {
        id: "phase_1",
        name: "Launch",
        description: "Ship the campaign.",
        startOffsetDays: 0,
        durationDays: 7,
      },
    ];
  }

  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  const totalDays =
    Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(1, Math.round((end - start) / 86_400_000))
      : 21;
  const third = Math.max(1, Math.round(totalDays / 3));

  return [
    {
      id: "phase_1",
      name: "Tease",
      description: "Build anticipation before launch.",
      startOffsetDays: 0,
      durationDays: third,
    },
    {
      id: "phase_2",
      name: "Launch",
      description: "Go live and drive the primary message.",
      startOffsetDays: third,
      durationDays: third,
    },
    {
      id: "phase_3",
      name: "Sustain",
      description: "Keep the campaign alive after the peak.",
      startOffsetDays: third * 2,
      durationDays: Math.max(1, totalDays - third * 2),
    },
  ];
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    if (value === null || value === undefined || value === "") {
      throwFormatError("CAMPAIGN_INVALID_INPUT", `${label} is required`);
    }
    throwFormatError("CAMPAIGN_INVALID_INPUT", `${label} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throwFormatError(
      "CAMPAIGN_INVALID_INPUT",
      `${label} must be at most ${max} characters`,
    );
  }
  return trimmed;
}
function requireTone(value: string): LaunchStrategy["tone"] {
  return isTone(value) ? value : "BRAND";
}

function isTone(value: string): value is LaunchStrategy["tone"] {
  return (CAMPAIGN_TONES as readonly string[]).includes(value);
}
function platformName(id: string): string {
  return getPlatform(id)?.name ?? id;
}

/**
 * A deterministic plan still has to name a channel, or the format resolver has
 * nothing to check the platform against. The platform's first declared channel
 * is the honest default: it is a channel the platform actually carries.
 */
function defaultChannelFor(platformId: string): string | null {
  return getPlatform(platformId)?.channels[0] ?? null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

