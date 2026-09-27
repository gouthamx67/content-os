import { BrowserError, type BrowserSession, type InteractionStep } from "../core/domain/browser";
import { HttpError } from "./http";

/**
 * HTTP surface for the browser agent: strict input parsing, safe
 * serialization, and one error taxonomy so a blocked URL or a failed
 * verification reads the same way everywhere.
 */

export interface SerializedSession extends Omit<BrowserSession, "targetClass" | "status"> {
  targetClass: BrowserSession["targetClass"];
  status: BrowserSession["status"];
}

/**
 * Stored observations are persisted as JSON text so the schema stays portable.
 * The API hands the client a parsed object rather than a raw string, and never
 * lets a malformed row break the response.
 */
export function serializeObservation(record: {
  id: string;
  stepOrder: number;
  url: string;
  title: string;
  pageStateHash: string;
  payload: string;
  createdAt: string;
}) {
  let payload: unknown = null;
  try {
    payload = JSON.parse(record.payload) as unknown;
  } catch {
    payload = { error: "unreadable observation" };
  }
  return {
    id: record.id,
    stepOrder: record.stepOrder,
    url: record.url,
    title: record.title,
    pageStateHash: record.pageStateHash,
    createdAt: record.createdAt,
    payload,
  };
}

export function serializeSession(session: BrowserSession): SerializedSession {
  return {
    id: session.id,
    projectId: session.projectId,
    targetSourceId: session.targetSourceId,
    targetClass: session.targetClass,
    initialUrl: session.initialUrl,
    currentUrl: session.currentUrl,
    status: session.status,
    goal: session.goal,
    successCriteria: session.successCriteria,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    pageCount: session.pageCount,
    actionCount: session.actionCount,
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function serializeStep(step: InteractionStep) {
  return {
    order: step.order,
    actionType: step.actionType,
    targetSummary: step.targetSummary,
    inputSummary: step.inputSummary,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: step.durationMs,
    pageStateHashBefore: step.pageStateHashBefore,
    pageStateHashAfter: step.pageStateHashAfter,
    result: step.result,
    errorCode: step.errorCode,
    errorMessage: step.errorMessage,
  };
}

const MAX_GOAL_CHARS = 500;
const MAX_CRITERIA_CHARS = 300;

export interface ParsedRunRequest {
  targetSourceId: string;
  /** Optional: the server falls back to the target source's own URI. */
  url: string | null;
  goal: string;
  successCriteria: string | null;
}

function readString(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Field "${field}" is required`);
  }
  if (value.length > max) {
    throw new HttpError(400, `Field "${field}" exceeds ${max} characters`);
  }
  return value.trim();
}

export function parseRunRequest(body: unknown): ParsedRunRequest {
  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  return {
    targetSourceId: readString(record, "targetSourceId", 200),
    url:
      typeof record["url"] === "string" && record["url"].trim().length > 0
        ? readString(record, "url", 2_048)
        : null,
    goal: readString(record, "goal", MAX_GOAL_CHARS),
    successCriteria:
      typeof record["successCriteria"] === "string" && record["successCriteria"].trim().length > 0
        ? record["successCriteria"].trim().slice(0, MAX_CRITERIA_CHARS)
        : null,
  };
}

const STATUS_BY_CODE: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  NAVIGATION_BLOCKED: 400,
  TARGET_NOT_FOUND: 422,
  TARGET_AMBIGUOUS: 422,
  ACTION_INVALID: 422,
  VERIFICATION_FAILED: 422,
  UPLOAD_BLOCKED: 422,
  NETWORK_BLOCKED: 422,
  LOCAL_APP_FAILED: 400,
  LOCAL_APP_TIMEOUT: 400,
  SESSION_TIMEOUT: 504,
  ACTION_TIMEOUT: 504,
  BROWSER_START_FAILED: 503,
  BROWSER_CRASHED: 503,
  POPUP_FAILED: 502,
  DIALOG_FAILED: 502,
  ACTION_FAILED: 502,
};

export function wrapBrowserHttpError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof BrowserError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: STATUS_BY_CODE[error.code] ?? 500 },
    );
  }
  return Response.json({ error: "Browser agent request failed" }, { status: 500 });
}
