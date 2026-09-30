import {
  CREATIVE_ANGLES,
  CREATIVE_DIRECTION_STATUSES,
  CREATIVE_MODES,
  CreativeError,
  isCreativeAngle,
  isCreativeDirectionStatus,
  isCreativeMode,
  type CreativeAngle,
  type CreativeDirection,
  type CreativeDirectionStatus,
  type CreativeMode,
} from "../core/domain/creative-direction";
import { CREATIVE_STYLE_LIST } from "../core/domain/creative-style";
import { getCreativeModePolicy } from "../core/services/creative-mode-policy";
import { CreativeValidationFailure } from "../core/services/creative-direction-validator";
import { HttpError, jsonError, wrapHttpError } from "./http";

const CREATIVE_ERROR_STATUS: Readonly<Record<string, number>> = {
  CREATIVE_INVALID_INPUT: 400,
  CREATIVE_FIELD_MISSING: 422,
  CREATIVE_FIELD_TOO_LONG: 422,
  CREATIVE_LIST_TOO_SHORT: 422,
  CREATIVE_INVALID_SCORE: 422,
  CREATIVE_UNKNOWN_ANGLE: 422,
  CREATIVE_UNKNOWN_CLAIM: 422,
  CREATIVE_UNKNOWN_EVIDENCE: 422,
  CREATIVE_UNKNOWN_ASSET: 422,
  CREATIVE_CLAIM_UNVERIFIED: 422,
  CREATIVE_EVIDENCE_MISMATCH: 422,
  CREATIVE_UNSUPPORTED_QUANTIFIED_CLAIM: 422,
  CREATIVE_MODE_MISMATCH: 422,
  CREATIVE_MODE_CONFLICT: 422,
  CREATIVE_MODE_REQUIRES_PRODUCT_UI: 422,
  CREATIVE_INVALID_OUTPUT: 422,
  // 409: the request was valid, but the project cannot answer it yet.
  CREATIVE_INSUFFICIENT_CONTEXT: 409,
  CREATIVE_DIRECTION_FAILED: 502,
  CREATIVE_DIRECTION_NOT_FOUND: 404,
  CREATIVE_SCOPE_VIOLATION: 403,
  CREATIVE_INTENT_NOT_RESOLVED: 409,
};

export function wrapCreativeHttpError(error: unknown): Response {
  if (error instanceof CreativeError) {
    return jsonError(CREATIVE_ERROR_STATUS[error.code] ?? 500, error.message, {
      code: error.code,
    });
  }
  // A refused direction is a 422 naming every rule it broke. Answering 500 would
  // tell the caller the server broke, when in fact the server worked and the
  // direction did not.
  if (error instanceof CreativeValidationFailure) {
    const first = error.issues[0]?.code;
    return jsonError(
      first ? (CREATIVE_ERROR_STATUS[first] ?? 422) : 422,
      error.message,
      { code: first ?? "CREATIVE_INVALID_OUTPUT", issues: error.issues.map((i) => ({ ...i })) },
    );
  }
  return wrapHttpError(error);
}

/**
 * The registries and policies travel with every response. The panel needs them to
 * offer only valid choices, and a list hard-coded in the client would drift the
 * first time a mode or a style is added.
 */
export function creativeRegistry() {
  return {
    modes: CREATIVE_MODES.map((mode) => {
      const policy = getCreativeModePolicy(mode);
      return {
        id: mode,
        description: policy.description,
        allowMetaphor: policy.allowMetaphor,
        allowExperimentalHooks: policy.allowExperimentalHooks,
        requireProductUi: policy.requireProductUi,
        allowConceptualVisuals: policy.allowConceptualVisuals,
        allowedAngles: [...policy.allowedAngles],
        maxUnverifiedClaims: policy.maxUnverifiedClaims,
      };
    }),
    angles: [...CREATIVE_ANGLES],
    statuses: [...CREATIVE_DIRECTION_STATUSES],
    styles: CREATIVE_STYLE_LIST.map((style) => ({
      id: style.id,
      angles: [...style.angles],
      description: style.description,
      bestFor: style.bestFor,
      avoidWhen: style.avoidWhen,
    })),
    limits: { maxFieldLength: 600, maxListItems: 8, maxSentenceLength: 320 },
  };
}

export type SerializedCreativeDirection = {
  id: string;
  projectId: string;
  intentId: string;
  creativeRunId: string;
  name: string;
  angle: CreativeAngle;
  thesis: string;
  hook: CreativeDirection["hook"];
  audienceAngle: string;
  emotionalAngle: string;
  narrativeSummary: string;
  visualStrategy: CreativeDirection["visualStrategy"];
  proofStrategy: CreativeDirection["proofStrategy"];
  voiceDirection: string;
  musicDirection: string;
  soundDirection: string;
  cta: string | null;
  rationale: string;
  mode: CreativeMode;
  status: CreativeDirectionStatus;
  editedByUser: boolean;
  brandVersion: number | null;
  intelligenceVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `strengthScore` is not sent. It is an internal ordering used to sort drafts
 * for a reader who asked for more than five; a client that displays it would be
 * telling the user which idea is best, which is not what the score means.
 */
export function serializeCreativeDirection(
  direction: CreativeDirection,
): SerializedCreativeDirection {
  return {
    id: direction.id,
    projectId: direction.projectId,
    intentId: direction.intentId,
    creativeRunId: direction.creativeRunId,
    name: direction.name,
    angle: direction.angle,
    thesis: direction.thesis,
    hook: direction.hook,
    audienceAngle: direction.audienceAngle,
    emotionalAngle: direction.emotionalAngle,
    narrativeSummary: direction.narrativeSummary,
    visualStrategy: direction.visualStrategy,
    proofStrategy: direction.proofStrategy,
    voiceDirection: direction.voiceDirection,
    musicDirection: direction.musicDirection,
    soundDirection: direction.soundDirection,
    cta: direction.cta,
    rationale: direction.rationale,
    mode: direction.mode,
    status: direction.status,
    editedByUser: direction.editedByUser,
    brandVersion: direction.brandVersion,
    intelligenceVersion: direction.intelligenceVersion,
    createdAt: direction.createdAt,
    updatedAt: direction.updatedAt,
  };
}

export type GenerateCreativeRequest = {
  intentId: string;
  mode: CreativeMode;
  count?: number;
};

/**
 * Only the three fields a person chooses are read. The body cannot carry brand or
 * intelligence versions, assets, evidence or claims: those are the server's to
 * derive, and accepting them from a client would let a caller ask for a direction
 * grounded in material this project does not have.
 */
export function parseGenerateCreativeRequest(body: unknown): GenerateCreativeRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "A JSON object body is required");
  }
  const record = body as Record<string, unknown>;

  const rejected = [
    "brandVersion",
    "intelligenceVersion",
    "assets",
    "evidence",
    "claims",
    "context",
    "projectId",
    "strengthScore",
  ].filter((key) => key in record);
  if (rejected.length > 0) {
    throw new HttpError(
      400,
      `The server derives ${rejected.join(", ")} from the project. Send only intentId, mode and count.`,
    );
  }

  const intentId = record.intentId;
  if (typeof intentId !== "string" || !intentId.trim()) {
    throw new HttpError(400, "intentId is required");
  }

  const mode = record.mode ?? "BALANCED";
  if (!isCreativeMode(mode)) {
    throw new HttpError(400, `mode must be one of ${CREATIVE_MODES.join(", ")}`);
  }

  const count = record.count;
  if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count))) {
    throw new HttpError(400, "count must be a whole number");
  }

  return {
    intentId: intentId.trim(),
    mode,
    ...(count === undefined ? {} : { count }),
  };
}

export type CreativeDirectionEditRequest = {
  name?: string;
  angle?: CreativeAngle;
  thesis?: string;
  hook?: CreativeDirection["hook"];
  audienceAngle?: string;
  emotionalAngle?: string;
  narrativeSummary?: string;
  visualStrategy?: CreativeDirection["visualStrategy"];
  proofStrategy?: CreativeDirection["proofStrategy"];
  voiceDirection?: string;
  musicDirection?: string;
  soundDirection?: string;
  cta?: string | null;
  rationale?: string;
  status?: CreativeDirectionStatus;
};

const EDITABLE_FIELDS = [
  "name",
  "angle",
  "thesis",
  "hook",
  "audienceAngle",
  "emotionalAngle",
  "narrativeSummary",
  "visualStrategy",
  "proofStrategy",
  "voiceDirection",
  "musicDirection",
  "soundDirection",
  "cta",
  "rationale",
  "status",
] as const;

/**
 * Only the fields the domain lets a person change are accepted. A field that is
 * absent from the request is left alone; one that is present is taken whole, so a
 * partial nested object cannot leave a half-written strategy behind.
 */
export function parseCreativeDirectionEditRequest(body: unknown): CreativeDirectionEditRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "A JSON object body is required");
  }
  const record = body as Record<string, unknown>;

  const unknownFields = Object.keys(record).filter(
    (key) => !(EDITABLE_FIELDS as readonly string[]).includes(key),
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      400,
      `These fields are not editable: ${unknownFields.join(", ")}`,
    );
  }

  const edit: CreativeDirectionEditRequest = {};

  for (const key of EDITABLE_FIELDS) {
    if (!(key in record)) continue;
    const value = record[key];

    if (key === "angle") {
      if (!isCreativeAngle(value)) {
        throw new HttpError(400, `angle must be one of ${CREATIVE_ANGLES.join(", ")}`);
      }
      edit.angle = value;
      continue;
    }

    if (key === "status") {
      if (!isCreativeDirectionStatus(value)) {
        throw new HttpError(400, `status must be one of ${CREATIVE_DIRECTION_STATUSES.join(", ")}`);
      }
      edit.status = value;
      continue;
    }

    if (key === "cta") {
      if (value !== null && typeof value !== "string") {
        throw new HttpError(400, "cta must be a string or null");
      }
      edit.cta = value as string | null;
      continue;
    }

    if (key === "hook" || key === "visualStrategy" || key === "proofStrategy") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new HttpError(400, `${key} must be an object`);
      }
      if (key === "hook") edit.hook = value as CreativeDirection["hook"];
      if (key === "visualStrategy") edit.visualStrategy = value as CreativeDirection["visualStrategy"];
      if (key === "proofStrategy") edit.proofStrategy = value as CreativeDirection["proofStrategy"];
      continue;
    }

    if (typeof value !== "string") {
      throw new HttpError(400, `${key} must be a string`);
    }
    edit[key] = value as never;
  }

  return edit;
}
