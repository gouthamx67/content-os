import { CAMPAIGN_LIMITS, type CampaignBrief, type CampaignTone } from "./types";
import { CAMPAIGN_TONES } from "./types";
import type { CampaignErrorCode } from "../errors";
import { CampaignError } from "../errors";

function fail(code: CampaignErrorCode, message: string): never {
  throw new CampaignError(code, message);
}

function requireString(
  value: unknown,
  label: string,
  max: number,
  options: { min?: number } = {},
): string {
  if (typeof value !== "string") {
    fail("CAMPAIGN_INVALID_INPUT", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) {
    fail("CAMPAIGN_INVALID_INPUT", `${label} is required`);
  }
  if (trimmed.length > max) {
    fail(
      "CAMPAIGN_INVALID_INPUT",
      `${label} must be at most ${max} characters`,
    );
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  label: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail("CAMPAIGN_INVALID_INPUT", `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    fail(
      "CAMPAIGN_INVALID_INPUT",
      `${label} must be at most ${max} characters`,
    );
  }
  return trimmed.length === 0 ? null : trimmed;
}

function stringList(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail("CAMPAIGN_INVALID_INPUT", `${label} must be a list`);
  }
  if (value.length > maxItems) {
    fail(
      "CAMPAIGN_INVALID_INPUT",
      `${label} must contain at most ${maxItems} entries`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      fail("CAMPAIGN_INVALID_INPUT", `${label} entries must be strings`);
    }
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLength) {
      fail(
        "CAMPAIGN_INVALID_INPUT",
        `${label} entries must be at most ${maxLength} characters`,
      );
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isTone(value: unknown): value is CampaignTone {
  return (
    typeof value === "string" &&
    (CAMPAIGN_TONES as readonly string[]).includes(value)
  );
}

export type CampaignHeadlineInput = {
  name: string;
  objective: string;
  audienceSummary: string;
  keyMessage: string;
};

export function validateHeadline(input: {
  name: unknown;
  objective: unknown;
  audienceSummary: unknown;
  keyMessage: unknown;
}): CampaignHeadlineInput {
  return {
    name: requireString(
      input.name,
      "Campaign name",
      CAMPAIGN_LIMITS.maxNameLength,
    ),
    objective: requireString(
      input.objective,
      "Objective",
      CAMPAIGN_LIMITS.maxObjectiveLength,
    ),
    audienceSummary: requireString(
      input.audienceSummary,
      "Audience",
      CAMPAIGN_LIMITS.maxAudienceLength,
    ),
    keyMessage: requireString(
      input.keyMessage,
      "Key message",
      CAMPAIGN_LIMITS.maxKeyMessageLength,
    ),
  };
}

export function validateBrief(brief: unknown): CampaignBrief {
  const value = (brief ?? {}) as Record<string, unknown>;

  const tone = isTone(value["tone"]) ? value["tone"] : "BRAND";

  const launchWindow = parseLaunchWindow(value["launchWindow"]);

  return {
    tone,
    constraints: stringList(
      value["constraints"],
      "Constraints",
      CAMPAIGN_LIMITS.maxConstraints,
      CAMPAIGN_LIMITS.maxConstraintLength,
    ),
    keyMessages: stringList(
      value["keyMessages"],
      "Key messages",
      CAMPAIGN_LIMITS.maxKeyMessages,
      CAMPAIGN_LIMITS.maxKeyMessageLength,
    ),
    successMetrics: stringList(
      value["successMetrics"],
      "Success metrics",
      CAMPAIGN_LIMITS.maxSuccessMetrics,
      CAMPAIGN_LIMITS.maxConstraintLength,
    ),
    sourceIds: stringList(
      value["sourceIds"],
      "Grounding sources",
      CAMPAIGN_LIMITS.maxSources,
      200,
    ),
    launchWindow,
    notes: optionalString(
      value["notes"],
      "Notes",
      CAMPAIGN_LIMITS.maxNotesLength,
    ),
  };
}

function parseLaunchWindow(
  value: unknown,
): CampaignBrief["launchWindow"] {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    fail("CAMPAIGN_INVALID_INPUT", "Launch window must be an object");
  }
  const window = value as Record<string, unknown>;
  const start = requireString(window["start"], "Launch window start", 64);
  const end = requireString(window["end"], "Launch window end", 64);
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    fail("CAMPAIGN_INVALID_INPUT", "Launch window dates must be ISO timestamps");
  }
  if (endMs < startMs) {
    fail("CAMPAIGN_INVALID_INPUT", "Launch window must end after it starts");
  }
  return { start, end };
}

export type DeliverableBriefInput = {
  objective: string;
  keyMessage: string;
  notes: string | null;
  phaseId: string | null;
};

export function validateDeliverableBrief(
  brief: unknown,
): DeliverableBriefInput {
  const value = (brief ?? {}) as Record<string, unknown>;
  return {
    objective: requireString(
      value["objective"],
      "Deliverable objective",
      CAMPAIGN_LIMITS.maxObjectiveLength,
    ),
    keyMessage: requireString(
      value["keyMessage"],
      "Deliverable key message",
      CAMPAIGN_LIMITS.maxKeyMessageLength,
    ),
    notes: optionalString(
      value["notes"],
      "Deliverable notes",
      CAMPAIGN_LIMITS.maxNotesLength,
    ),
    phaseId: optionalString(value["phaseId"], "Phase", 120),
  };
}

export function validateDeliverableTitle(value: unknown): string {
  return requireString(
    value,
    "Deliverable title",
    CAMPAIGN_LIMITS.maxDeliverableTitle,
  );
}

export function ensureDeliverableCount(count: number): void {
  if (count > CAMPAIGN_LIMITS.maxDeliverables) {
    fail(
      "CAMPAIGN_DELIVERABLE_LIMIT_EXCEEDED",
      `A campaign may hold at most ${CAMPAIGN_LIMITS.maxDeliverables} deliverables`,
    );
  }
}

export { fail as failCampaign };
