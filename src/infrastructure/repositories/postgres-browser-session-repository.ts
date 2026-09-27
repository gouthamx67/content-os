import { randomUUID } from "node:crypto";
import type { Models } from "../../prisma/contract.d";
import { db } from "../../prisma/db";
import { pgTimestampToIso } from "../../lib/time";
import {
  BrowserError,
  canTransitionSessionStatus,
  type BrowserErrorCode,
  type BrowserObservation,
  type BrowserSession,
  type BrowserSessionStatus,
  type BrowserTargetClass,
  type InteractionStep,
  type InteractionTrace,
  type ObservedElement,
} from "../../core/domain/browser";
import type {
  BrowserObservationRecord,
  BrowserSessionPageState,
  BrowserSessionRepository,
  CreateBrowserSessionInput,
} from "../../core/ports/browser-session-repository";

type SessionRow = Omit<Models.public_BrowserSession, "project" | "targetSource" | "steps" | "observations">;
type StepRow = Omit<Models.public_BrowserStep, "session">;
type ObservationRow = Omit<Models.public_BrowserObservation, "session">;

/** Per-observation payload cap; keeps traces reviewable instead of exhaustive. */
const MAX_OBSERVATION_PAYLOAD_CHARS = 8_000;
const MAX_STEPS_RETURNED = 500;

function nowIso(): string {
  return new Date().toISOString();
}

function mapSession(row: SessionRow): BrowserSession {
  return {
    id: row.id,
    projectId: row.projectId,
    targetSourceId: row.targetSourceId,
    targetClass: row.targetClass as BrowserTargetClass,
    initialUrl: row.initialUrl,
    currentUrl: row.currentUrl,
    status: row.status as BrowserSessionStatus,
    goal: row.goal,
    successCriteria: row.successCriteria,
    startedAt: row.startedAt === null ? null : pgTimestampToIso(row.startedAt),
    endedAt: row.endedAt === null ? null : pgTimestampToIso(row.endedAt),
    pageCount: row.pageCount,
    actionCount: row.actionCount,
    errorCode: row.errorCode as BrowserErrorCode | null,
    errorMessage: row.errorMessage,
    createdAt: pgTimestampToIso(row.createdAt),
    updatedAt: pgTimestampToIso(row.updatedAt),
  };
}

function mapStep(row: StepRow): InteractionStep {
  return {
    order: row.order,
    actionType: row.actionType as InteractionStep["actionType"],
    targetSummary: row.targetSummary,
    inputSummary: row.inputSummary,
    status: row.status as InteractionStep["status"],
    startedAt: row.startedAt === null ? null : pgTimestampToIso(row.startedAt),
    completedAt: row.completedAt === null ? null : pgTimestampToIso(row.completedAt),
    durationMs: row.durationMs,
    pageStateHashBefore: row.stateHashBefore,
    pageStateHashAfter: row.stateHashAfter,
    result: row.result,
    errorCode: row.errorCode as BrowserErrorCode | null,
    errorMessage: row.errorMessage,
  };
}

function mapObservation(row: ObservationRow): BrowserObservationRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    stepOrder: row.stepOrder,
    pageId: row.pageId,
    url: row.url,
    title: row.title,
    pageStateHash: row.stateHash,
    payload: row.payload,
    createdAt: pgTimestampToIso(row.createdAt),
  };
}

function notFound(sessionId: string): BrowserError {
  return new BrowserError("SESSION_NOT_FOUND", `Browser session ${sessionId} was not found`);
}

/**
 * Trims an observation to a storable payload. Only structural fields are kept:
 * no raw DOM, no form values, and page text is capped.
 */
export function observationPayload(observation: BrowserObservation): string {
  const elements: ObservedElement[] = observation.interactiveElements.slice(0, 60).map((element) => ({
    role: element.role,
    name: element.name.slice(0, 200),
    kind: element.kind,
  }));
  const payload = JSON.stringify({
    pageText: observation.pageText.slice(0, 2_000),
    interactiveElements: elements,
    dialogs: observation.dialogs.slice(0, 10).map((dialog) => ({ role: dialog.role, name: dialog.name })),
    forms: observation.forms.slice(0, 10).map((form) => ({ role: form.role, name: form.name })),
    links: observation.links.slice(0, 30).map((link) => ({ role: link.role, name: link.name })),
    consoleErrors: observation.consoleErrors.slice(0, 10),
  });
  return payload.length > MAX_OBSERVATION_PAYLOAD_CHARS
    ? `${payload.slice(0, MAX_OBSERVATION_PAYLOAD_CHARS - 1)}…`
    : payload;
}

export class PostgresBrowserSessionRepository implements BrowserSessionRepository {
  constructor(private readonly orm = db.orm.public) {}

  async createSession(input: CreateBrowserSessionInput): Promise<BrowserSession> {
    const row = await this.orm.BrowserSession.create({
      id: input.id,
      projectId: input.projectId,
      targetSourceId: input.targetSourceId,
      targetClass: input.targetClass,
      initialUrl: input.initialUrl,
      currentUrl: input.initialUrl,
      status: input.status,
      goal: input.goal,
      successCriteria: input.successCriteria,
    });
    return mapSession(row as SessionRow);
  }

  async getSession(projectId: string, sessionId: string): Promise<BrowserSession | null> {
    const row = await this.orm.BrowserSession.where({ id: sessionId, projectId }).first();
    return row === null ? null : mapSession(row as SessionRow);
  }

  async listSessions(projectId: string, limit = 25): Promise<BrowserSession[]> {
    const rows = await this.orm.BrowserSession.where((session) => session.projectId.eq(projectId))
      .orderBy((session) => session.createdAt.desc())
      .limit(Math.min(limit, 100))
      .all();
    return rows.map((row) => mapSession(row as SessionRow));
  }

  async updateSessionState(
    projectId: string,
    sessionId: string,
    state: Partial<BrowserSessionPageState>,
  ): Promise<BrowserSession> {
    const existing = await this.getSession(projectId, sessionId);
    if (!existing) throw notFound(sessionId);
    if (state.status && !canTransitionSessionStatus(existing.status, state.status)) {
      throw new BrowserError(
        "ACTION_INVALID",
        `Illegal session transition ${existing.status} -> ${state.status}`,
      );
    }
    const changes: Record<string, unknown> = {};
    if (state.currentUrl !== undefined) changes["currentUrl"] = state.currentUrl;
    if (state.status !== undefined) changes["status"] = state.status;
    if (state.pageCount !== undefined) changes["pageCount"] = state.pageCount;
    if (state.actionCount !== undefined) changes["actionCount"] = state.actionCount;
    if (state.startedAt !== undefined) changes["startedAt"] = state.startedAt;
    if (state.endedAt !== undefined) changes["endedAt"] = state.endedAt;
    if (state.errorCode !== undefined) changes["errorCode"] = state.errorCode;
    if (state.errorMessage !== undefined) changes["errorMessage"] = state.errorMessage;

    const row = await this.orm.BrowserSession.where({ id: sessionId, projectId }).update(changes);
    if (row === null) throw notFound(sessionId);
    return mapSession(row as SessionRow);
  }

  async appendStep(
    projectId: string,
    sessionId: string,
    step: InteractionStep,
  ): Promise<void> {
    const session = await this.getSession(projectId, sessionId);
    if (!session) throw notFound(sessionId);
    await this.orm.BrowserStep.create({
      id: `bs_${randomUUID()}`,
      sessionId,
      order: step.order,
      actionType: step.actionType,
      targetSummary: step.targetSummary,
      inputSummary: step.inputSummary,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs: step.durationMs,
      stateHashBefore: step.pageStateHashBefore,
      stateHashAfter: step.pageStateHashAfter,
      result: step.result,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
    });
  }

  async getTrace(projectId: string, sessionId: string): Promise<InteractionTrace | null> {
    const session = await this.getSession(projectId, sessionId);
    if (!session) return null;
    const rows = await this.orm.BrowserStep.where((step) => step.sessionId.eq(sessionId))
      .orderBy((step) => step.order.asc())
      .limit(MAX_STEPS_RETURNED)
      .all();
    return {
      steps: rows.map((row) => mapStep(row as StepRow)),
      startedAt: session.startedAt,
      completedAt: session.endedAt,
    };
  }

  async recordObservation(
    record: Omit<BrowserObservationRecord, "id" | "createdAt">,
  ): Promise<void> {
    await this.orm.BrowserObservation.create({
      id: `bo_${randomUUID()}`,
      sessionId: record.sessionId,
      stepOrder: record.stepOrder,
      pageId: record.pageId,
      url: record.url.slice(0, 2_000),
      title: record.title.slice(0, 300),
      stateHash: record.pageStateHash,
      payload: record.payload,
      createdAt: nowIso(),
    });
  }

  async listObservations(
    projectId: string,
    sessionId: string,
    limit = 100,
  ): Promise<BrowserObservationRecord[]> {
    const session = await this.getSession(projectId, sessionId);
    if (!session) return [];
    const rows = await this.orm.BrowserObservation.where((observation) => observation.sessionId.eq(sessionId))
      .orderBy((observation) => observation.createdAt.asc())
      .limit(Math.min(limit, 500))
      .all();
    return rows.map((row) => mapObservation(row as ObservationRow));
  }

  async cancelSession(projectId: string, sessionId: string): Promise<BrowserSession | null> {
    const existing = await this.getSession(projectId, sessionId);
    if (!existing) return null;
    if (existing.status === "COMPLETED" || existing.status === "FAILED" || existing.status === "CANCELLED") {
      return existing;
    }
    return this.updateSessionState(projectId, sessionId, {
      status: "CANCELLED",
      endedAt: nowIso(),
    });
  }
}
