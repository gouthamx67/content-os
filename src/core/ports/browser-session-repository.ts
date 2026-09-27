import type {
  BrowserSession,
  BrowserSessionStatus,
  InteractionTrace,
} from "../domain/browser";

export interface BrowserObservationRecord {
  id: string;
  sessionId: string;
  stepOrder: number;
  pageId: string;
  url: string;
  title: string;
  pageStateHash: string;
  /** Normalized observation payload, redacted and size-capped by the writer. */
  payload: string;
  createdAt: string;
}

export interface CreateBrowserSessionInput {
  id: string;
  projectId: string;
  targetSourceId: string;
  targetClass: BrowserSession["targetClass"];
  initialUrl: string;
  goal: string | null;
  successCriteria: string | null;
  status: BrowserSessionStatus;
}

export interface BrowserSessionPageState {
  currentUrl: string;
  status: BrowserSessionStatus;
  pageCount: number;
  actionCount: number;
  startedAt: string | null;
  endedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Persistence for browser agent sessions. Every mutation is scoped by
 * {@link BrowserSession.projectId} so project authorization is enforced in one
 * place, and every update is monotonic: terminal statuses never reopen.
 */
export interface BrowserSessionRepository {
  createSession(input: CreateBrowserSessionInput): Promise<BrowserSession>;

  getSession(projectId: string, sessionId: string): Promise<BrowserSession | null>;

  listSessions(projectId: string, limit?: number): Promise<BrowserSession[]>;

  /** Applies a status/page/action-count update, rejecting illegal transitions. */
  updateSessionState(
    projectId: string,
    sessionId: string,
    state: Partial<BrowserSessionPageState>,
  ): Promise<BrowserSession>;

  appendStep(
    projectId: string,
    sessionId: string,
    step: InteractionTrace["steps"][number],
  ): Promise<void>;

  getTrace(projectId: string, sessionId: string): Promise<InteractionTrace | null>;

  /** Stores the observation captured for a step, already redacted. */
  recordObservation(record: Omit<BrowserObservationRecord, "id" | "createdAt">): Promise<void>;

  listObservations(
    projectId: string,
    sessionId: string,
    limit?: number,
  ): Promise<BrowserObservationRecord[]>;

  /** Best-effort cancellation of a QUEUED or RUNNING session. */
  cancelSession(projectId: string, sessionId: string): Promise<BrowserSession | null>;
}
