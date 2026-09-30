/**
 * The HTTP edge of the storyboard checkpoint.
 *
 * Like the creative-direction API, this file owns the mapping in both directions:
 * what a stored storyboard looks like on the wire, and what a request is allowed
 * to say. The request parsers are deliberately narrow — a client can ask for a
 * plan, an edit, a move, a selection or a lock, and nothing else. Anything the
 * server derives (the context, the identity, the timeline, the provenance) is not
 * accepted from a caller even when it would be convenient, because a body that can
 * set its own timings is a body that can store a plan that does not add up.
 */

import {
  STORYBOARD_CAPTURE_MODES,
  STORYBOARD_SCENE_TYPES,
  STORYBOARD_STATUSES,
  STORYBOARD_TEXT_EMPHASIS,
  STORYBOARD_TEXT_POSITIONS,
  STORYBOARD_TEXT_ROLES,
  STORYBOARD_TRANSITION_TYPES,
  STORYBOARD_VISUAL_TYPES,
  StoryboardError,
  isStoryboardSceneType,
  isStoryboardStatus,
  isStoryboardTextEmphasis,
  isStoryboardTextPosition,
  isStoryboardTextRole,
  isStoryboardTransitionType,
  type EditableStoryboardScene,
  type Storyboard,
  type StoryboardStatus,
} from "../core/domain/storyboard";
import { HttpError, jsonError, wrapHttpError } from "./http";
import { MIN_TARGET_DURATION_MS } from "../core/services/storyboard-validator";

/**
 * Error codes to statuses.
 *
 * The distinction that matters here is 409 against 422: a 409 means the project
 * cannot answer this yet (no locked direction, no resolved intent), and a 422
 * means the request was answerable but the answer would not stand up.
 */
const STORYBOARD_ERROR_STATUS: Readonly<Record<string, number>> = {
  STORYBOARD_INVALID_INPUT: 422,
  STORYBOARD_DURATION_UNSUPPORTED: 422,
  // 409: valid request, but the piece is not ready to be planned yet.
  STORYBOARD_INTENT_NOT_RESOLVED: 409,
  STORYBOARD_DIRECTION_NOT_SELECTED: 409,
  STORYBOARD_INSUFFICIENT_CONTEXT: 409,
  // 403: the storyboard is the decided plan and cannot be changed.
  STORYBOARD_LOCKED: 403,
  STORYBOARD_INTENT_NOT_FOUND: 404,
  STORYBOARD_DIRECTION_NOT_FOUND: 404,
  STORYBOARD_NOT_FOUND: 404,
  // 502: the request was fine and the upstream planner was not.
  STORYBOARD_PLANNER_FAILED: 502,
};

export function wrapStoryboardHttpError(error: unknown): Response {
  if (error instanceof StoryboardError) {
    return jsonError(STORYBOARD_ERROR_STATUS[error.code] ?? 500, error.message, {
      code: error.code,
    });
  }
  return wrapHttpError(error);
}

/**
 * The vocabularies the panel needs in order to offer only valid choices. Sent with
 * every response rather than hard-coded in the client, for the same reason the
 * creative registry is: a list copied into the UI drifts the first time the domain
 * grows one.
 */
export function storyboardRegistry() {
  return {
    sceneTypes: [...STORYBOARD_SCENE_TYPES],
    statuses: [...STORYBOARD_STATUSES],
    visualTypes: [...STORYBOARD_VISUAL_TYPES],
    textRoles: [...STORYBOARD_TEXT_ROLES],
    textPositions: [...STORYBOARD_TEXT_POSITIONS],
    textEmphasis: [...STORYBOARD_TEXT_EMPHASIS],
    transitionTypes: [...STORYBOARD_TRANSITION_TYPES],
    captureModes: [...STORYBOARD_CAPTURE_MODES],
    limits: {
      minTargetDurationMs: MIN_TARGET_DURATION_MS,
      maxScenesPerPlan: 20,
      maxShotsPerScene: 6,
      maxOverlaysPerScene: 6,
    },
  };
}

export type SerializedStoryboard = {
  id: string;
  projectId: string;
  intentId: string;
  directionId: string;
  creativeRunId: string;
  name: string;
  status: StoryboardStatus;
  targetDurationMs: number;
  actualDurationMs: number;
  aspectRatio: string | null;
  platforms: string[];
  brandVersion: number | null;
  intelligenceVersion: number | null;
  version: number;
  scenes: Storyboard["scenes"];
  createdAt: string;
  updatedAt: string;
};

export function serializeStoryboard(board: Storyboard): SerializedStoryboard {
  return {
    id: board.id,
    projectId: board.projectId,
    intentId: board.intentId,
    directionId: board.directionId,
    creativeRunId: board.creativeRunId,
    name: board.name,
    status: board.status,
    targetDurationMs: board.targetDurationMs,
    actualDurationMs: board.actualDurationMs,
    aspectRatio: board.aspectRatio,
    platforms: [...board.platforms],
    brandVersion: board.brandVersion,
    intelligenceVersion: board.intelligenceVersion,
    version: board.version,
    scenes: board.scenes,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

export type GenerateStoryboardRequest = {
  intentId: string;
  directionId: string;
  targetDurationMs?: number;
};

/**
 * Only the three fields a person chooses are read. The body cannot carry scenes,
 * timings, provenance or context: the server derives all of it, and accepting any
 * of it from a client would let a caller store a plan the domain never approved.
 */
export function parseGenerateStoryboardRequest(body: unknown): GenerateStoryboardRequest {
  const record = requireObject(body);

  const rejected = [
    "scenes",
    "startMs",
    "endMs",
    "durationMs",
    "actualDurationMs",
    "status",
    "version",
    "brandVersion",
    "intelligenceVersion",
    "creativeRunId",
    "context",
    "projectId",
    "captureTargets",
  ].filter((key) => key in record);
  if (rejected.length > 0) {
    throw new HttpError(
      400,
      `The server derives ${rejected.join(", ")}. Send only intentId, directionId and targetDurationMs.`,
    );
  }

  return {
    intentId: requireId(record.intentId, "intentId"),
    directionId: requireId(record.directionId, "directionId"),
    ...(optionalDuration(record.targetDurationMs) !== undefined
      ? { targetDurationMs: optionalDuration(record.targetDurationMs) }
      : {}),
  };
}

export type UpdateStoryboardScenesRequest = {
  scenes: Array<{ sceneId: string; changes: EditableStoryboardScene }>;
};

/**
 * The editable fields, read one at a time and checked against the domain's own
 * vocabularies. `id`, `order` and the three timings are not among them: an edit
 * that set them would be refused by the service anyway, and refusing it here
 * names the field instead of failing later on a derived error.
 */
const EDITABLE_SCENE_FIELDS = [
  "type",
  "name",
  "purpose",
  "shots",
  "textOverlays",
  "voiceoverPlan",
  "musicDirection",
  "sfxCues",
  "transitionIn",
  "transitionOut",
  "featureIds",
  "workflowIds",
  "claimIds",
  "evidenceIds",
  "notes",
] as const;

const NON_EDITABLE_SCENE_FIELDS = [
  "id",
  "order",
  "startMs",
  "endMs",
  "durationMs",
  "captureRequirement",
] as const;

export function parseUpdateStoryboardScenesRequest(
  body: unknown,
): UpdateStoryboardScenesRequest {
  const record = requireObject(body);
  const scenes = record.scenes;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new HttpError(400, "scenes must be a non-empty array of edits");
  }

  return {
    scenes: scenes.map((raw, index) => {
      const entry = requireObject(raw, `scenes[${index}]`);
      const sceneId = requireId(entry.sceneId, `scenes[${index}].sceneId`);
      return { sceneId, changes: parseSceneChanges(entry.changes, `scenes[${index}].changes`) };
    }),
  };
}

function parseSceneChanges(raw: unknown, label: string): EditableStoryboardScene {
  const record = requireObject(raw, label);

  const rejected = NON_EDITABLE_SCENE_FIELDS.filter(
    (key) => key in record,
  ) as unknown as string[];
  if (rejected.length > 0) {
    throw new HttpError(
      400,
      `${label} cannot set ${rejected.join(", ")}. A scene keeps its own identity and timing.`,
    );
  }

  const unknown = Object.keys(record).filter(
    (key) => !(EDITABLE_SCENE_FIELDS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new HttpError(400, `${label} has unknown fields: ${unknown.join(", ")}`);
  }

  const changes: Record<string, unknown> = {};
  for (const key of EDITABLE_SCENE_FIELDS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    changes[key] = parseSceneField(key, value, `${label}.${key}`);
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, `${label} changes nothing`);
  }

  return changes as EditableStoryboardScene;
}

function parseSceneField(key: string, value: unknown, label: string): unknown {
  switch (key) {
    case "type":
      if (!isStoryboardSceneType(value)) {
        throw new HttpError(422, `${label} is not a scene type this domain has`);
      }
      return value;

    case "name":
    case "purpose":
    case "notes":
      return requireText(value, label);

    case "featureIds":
    case "workflowIds":
    case "claimIds":
    case "evidenceIds":
      return requireIdList(value, label);

    case "shots":
      return requireArray(value, label, 6).map((raw, index) => {
        const shot = requireObject(raw, `${label}[${index}]`);
        // A capture requirement is derived from what the shot shows and what the
        // project can actually record. It reads as one of a shot's fields, so it
        // has to be refused here: a block-list on the scene alone would let a
        // client write a capture job for a page this project does not have.
        if ("captureRequirement" in shot) {
          throw new HttpError(
            400,
            `${label}[${index}] cannot set captureRequirement. The server derives a capture job from the shot and the project.`,
          );
        }
        return shot;
      });

    case "textOverlays":
      return requireArray(value, label, 6).map((raw, index) => {
        const overlay = requireObject(raw, `${label}[${index}]`);
        return {
          ...overlay,
          role: requireEnum(
            overlay.role,
            isStoryboardTextRole,
            `${label}[${index}].role`,
          ),
          text: requireText(overlay.text, `${label}[${index}].text`),
          position: requireEnum(
            overlay.position,
            isStoryboardTextPosition,
            `${label}[${index}].position`,
          ),
          emphasis: requireEnum(
            overlay.emphasis,
            isStoryboardTextEmphasis,
            `${label}[${index}].emphasis`,
          ),
        };
      });

    case "transitionIn":
    case "transitionOut": {
      const plan = requireObject(value, label);
      return {
        ...plan,
        type: requireEnum(
          plan.type,
          isStoryboardTransitionType,
          `${label}.type`,
        ),
      };
    }

    default:
      // The remaining fields are structured objects the service validates against
      // the project. They are passed through whole rather than field-by-field,
      // because a half-parsed voiceover or cue list is a worse thing to store than
      // one the validator rejects with a named problem.
      return value;
  }
}

export type ReorderStoryboardSceneRequest = {
  sceneId: string;
  toIndex: number;
};

export function parseReorderStoryboardSceneRequest(
  body: unknown,
): ReorderStoryboardSceneRequest {
  const record = requireObject(body);
  const toIndex = record.toIndex;

  if (typeof toIndex !== "number" || !Number.isInteger(toIndex) || toIndex < 0) {
    throw new HttpError(400, "toIndex must be a whole number of zero or more");
  }

  return { sceneId: requireId(record.sceneId, "sceneId"), toIndex };
}

export function parseStatusFilter(value: string | null): StoryboardStatus | undefined {
  if (!value) return undefined;
  const status = value.toUpperCase();
  if (!isStoryboardStatus(status)) {
    throw new HttpError(400, `Unknown storyboard status "${value}"`);
  }
  return status;
}

// -----------------------------------------------------------------------------
// Small readers
// -----------------------------------------------------------------------------

function requireObject(value: unknown, label = "body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required`);
  }
  if (value.length > 200) {
    throw new HttpError(400, `${label} is too long to be an id`);
  }
  return value.trim();
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required`);
  }
  if (value.length > 600) {
    throw new HttpError(422, `${label} is longer than 600 characters`);
  }
  return value.trim();
}

function requireIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an array of ids`);
  }
  if (value.length > 12) {
    throw new HttpError(422, `${label} holds more ids than a scene can use`);
  }
  return value.map((item, index) => requireId(item, `${label}[${index}]`));
}

function requireArray(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an array`);
  }
  if (value.length > max) {
    throw new HttpError(422, `${label} holds more than ${max} entries`);
  }
  return value;
}

function requireEnum<T>(
  value: unknown,
  is: (candidate: unknown) => candidate is T,
  label: string,
): T {
  if (!is(value)) {
    throw new HttpError(422, `${label} is not a value this domain has`);
  }
  return value;
}

/**
 * A duration the caller may override. Bounds are loose here and enforced properly
 * by the validator, whose minimum is a policy rather than a transport concern.
 */
function optionalDuration(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "targetDurationMs must be a number of milliseconds");
  }
  return Math.round(value);
}
