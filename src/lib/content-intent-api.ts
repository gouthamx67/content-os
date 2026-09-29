import {
  ASPECT_RATIOS,
  ContentIntentError,
  isAspectRatio,
  type AspectRatio,
  type ContentIntent,
  type IntentClarification,
  type IntentSubject,
} from "../core/domain/content-intent";
import { CONTENT_TYPES, getContentType } from "../core/domain/content-type";
import { INTENT_LIMITS } from "../core/services/content-intent-validator";
import { PLATFORMS, getPlatform } from "../core/domain/platform";
import { HttpError, jsonError, wrapHttpError } from "./http";
import type { ContentIntentEdit } from "../core/services/content-intent-resolver";
import type { ContentIntentView } from "../core/services/content-intent-service";

const INTENT_ERROR_STATUS: Readonly<Record<string, number>> = {
  INTENT_INVALID_INPUT: 400,
  INTENT_REQUEST_EMPTY: 400,
  INTENT_NOT_FOUND: 404,
  INTENT_FORBIDDEN: 403,
  INTENT_SCOPE_VIOLATION: 403,
  INTENT_VALIDATION_FAILED: 422,
  INTENT_CONFLICT: 409,
  INTENT_AI_INVALID_OUTPUT: 422,
  INTENT_AI_UNAVAILABLE: 422,
};

const MAX_REQUEST_CHARS = 2_000;

export function wrapContentIntentHttpError(error: unknown): Response {
  if (error instanceof ContentIntentError) {
    return jsonError(INTENT_ERROR_STATUS[error.code] ?? 500, error.message, {
      code: error.code,
      ...(error.issues.length > 0 ? { issues: [...error.issues] } : {}),
    });
  }
  return wrapHttpError(error);
}

/**
 * The registries travel with every response. The editor needs them to offer only
 * valid choices, and a hard-coded list in the client would drift the first time
 * a content type is added.
 */
export type ContentIntentRegistry = {
  contentTypes: {
    id: string;
    name: string;
    description: string;
    channel: string;
    supportedPlatforms: string[];
    supportsDuration: boolean;
    supportsAspectRatio: boolean;
  }[];
  limits: {
    maxDurationSeconds: number;
    maxQuantity: number;
    maxCustomEdge: number;
  };
  platforms: { id: string; name: string; channels: string[] }[];
  aspectRatios: readonly string[];
};

export function contentIntentRegistry(): ContentIntentRegistry {
  return {
    contentTypes: CONTENT_TYPES.map((contentType) => ({
      id: contentType.id,
      name: contentType.name,
      description: contentType.description,
      channel: contentType.channel,
      supportedPlatforms: [...contentType.supportedPlatforms],
      supportsDuration: contentType.supportsDuration,
      supportsAspectRatio: contentType.supportsAspectRatio,
    })),
    limits: { ...INTENT_LIMITS },
    platforms: PLATFORMS.map((platform) => ({
      id: platform.id,
      name: platform.name,
      channels: [...platform.channels],
    })),
    aspectRatios: [...ASPECT_RATIOS],
  };
}

export type SerializedConstraint = {
  key: string;
  value: string;
  source: string;
};

export type SerializedClarification = {
  field: string;
  question: string;
  options?: { value: string; label: string }[];
};

export type SerializedContentIntent = {
  id: string;
  projectId: string;
  rawRequest: string;
  channel: string;
  contentTypeId: string;
  contentTypeName: string | null;
  contentTypeDescription: string | null;
  purpose: string | null;
  platforms: string[];
  platformNames: string[];
  subjects: IntentSubject[];
  audience: string | null;
  language: string | null;
  tone: string | null;
  style: string | null;
  durationSeconds: number | null;
  quantity: number;
  aspectRatio: string | null;
  customAspectRatio: { width: number; height: number } | null;
  cta: string | null;
  constraints: SerializedConstraint[];
  resolutionMode: string;
  status: string;
  confidence: string;
  unresolvedFields: string[];
  notes: string[];
  sourceIds: string[];
  brandVersion: number | null;
  intelligenceSnapshotVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

export function serializeContentIntent(intent: ContentIntent): SerializedContentIntent {
  const contentType = getContentType(intent.contentTypeId);

  return {
    id: intent.id,
    projectId: intent.projectId,
    rawRequest: intent.rawRequest,
    channel: intent.channel,
    contentTypeId: intent.contentTypeId,
    contentTypeName: contentType?.name ?? null,
    contentTypeDescription: contentType?.description ?? null,
    purpose: intent.purpose ?? null,
    platforms: [...intent.platforms],
    platformNames: intent.platforms.map(
      (platform) => getPlatform(platform)?.name ?? platform,
    ),
    subjects: intent.subjects.map((subject) => ({ ...subject })),
    audience: intent.audience ?? null,
    language: intent.language ?? null,
    tone: intent.tone ?? null,
    style: intent.style ?? null,
    durationSeconds: intent.durationSeconds ?? null,
    quantity: intent.quantity,
    aspectRatio: intent.aspectRatio ?? null,
    customAspectRatio: intent.customAspectRatio ?? null,
    cta: intent.cta ?? null,
    constraints: intent.constraints.map((constraint) => ({ ...constraint })),
    resolutionMode: intent.resolutionMode,
    status: intent.status,
    confidence: intent.confidence,
    unresolvedFields: [...intent.unresolvedFields],
    notes: [...intent.notes],
    sourceIds: [...intent.sourceIds],
    brandVersion: intent.brandVersion ?? null,
    intelligenceSnapshotVersion: intent.intelligenceSnapshotVersion ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

export function serializeContentIntentView(view: ContentIntentView) {
  return {
    intent: serializeContentIntent(view.intent),
    clarifications: view.clarifications.map(serializeClarification),
  };
}

function serializeClarification(
  clarification: IntentClarification,
): SerializedClarification {
  return {
    field: clarification.field,
    question: clarification.question,
    ...(clarification.options ? { options: clarification.options } : {}),
  };
}

export function parseResolveIntentRequest(body: unknown): {
  request: string;
  sourceIds: string[];
} {
  if (!isRecord(body)) {
    throw new HttpError(400, "A JSON body is required");
  }

  const request = stringField(body.request, "request");
  if (!request) {
    throw new HttpError(400, "A content request is required");
  }
  if (request.length > MAX_REQUEST_CHARS) {
    throw new HttpError(
      400,
      `A content request may be at most ${MAX_REQUEST_CHARS} characters`,
    );
  }

  // Sources are an attachment, not a requirement: someone asking a question in
  // their own words sends no sourceIds at all.
  const sourceIds = body.sourceIds === undefined ? [] : stringArrayField(body.sourceIds, "sourceIds") ?? [];

  return { request, sourceIds };
}

/**
 * An edit is partial on purpose: the editor sends the fields the user changed,
 * and every field it does not send keeps the value it had. An explicit `null`
 * clears a value, which is how a user says "no duration after all".
 */
export function parseIntentEditRequest(body: unknown): ContentIntentEdit {
  if (!isRecord(body)) {
    throw new HttpError(400, "A JSON body is required");
  }

  const edit: ContentIntentEdit = {};

  if ("contentTypeId" in body) {
    edit.contentTypeId =
      body.contentTypeId === null ? null : stringField(body.contentTypeId, "contentTypeId");
  }

  if ("platforms" in body) {
    edit.platforms = body.platforms === null ? null : stringArrayField(body.platforms, "platforms");
  }

  if ("durationSeconds" in body) {
    edit.durationSeconds = numberField(body.durationSeconds, "durationSeconds");
  }

  if ("aspectRatio" in body) {
    if (body.aspectRatio === null) {
      edit.aspectRatio = null;
    } else {
      const ratio = stringField(body.aspectRatio, "aspectRatio");
      if (!isAspectRatio(ratio as AspectRatio)) {
        throw new HttpError(400, `"${String(ratio)}" is not a supported aspect ratio`);
      }
      edit.aspectRatio = ratio as AspectRatio;
    }
  }

  if ("customAspectRatio" in body) {
    edit.customAspectRatio = dimensionsField(body.customAspectRatio);
  }

  if ("quantity" in body) {
    edit.quantity = numberField(body.quantity, "quantity");
  }

  for (const key of ["tone", "style", "language", "audience", "cta", "purpose"] as const) {
    if (!(key in body)) continue;
    edit[key] = body[key] === null ? null : stringField(body[key], key);
  }

  if (Object.keys(edit).length === 0) {
    throw new HttpError(400, "At least one intent field is required");
  }

  return edit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, label: string): string | null {
  if (typeof value !== "string") {
    throw new HttpError(400, `"${label}" must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringArrayField(value: unknown, label: string): string[] | null {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `"${label}" must be an array of strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new HttpError(400, `"${label}[${index}]" must be a string`);
    }
    return entry.trim();
  }).filter(Boolean);
}

function numberField(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, `"${label}" must be a whole number`);
  }
  return value;
}

function dimensionsField(
  value: unknown,
): { width: number; height: number } | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new HttpError(400, '"customAspectRatio" must be an object with width and height');
  }
  const width = value.width;
  const height = value.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 20_000 ||
    height > 20_000
  ) {
    throw new HttpError(400, '"customAspectRatio" needs whole pixel dimensions');
  }
  return { width, height };
}
