import type { CaptureSessionRecord, CaptureTakeRecord, CaptureMode, CaptureTakeStatus } from "../../modules/capture-engine/capture-types";

export interface CreateCaptureTakeInput {
  id: string;
  sessionId: string;
  projectId: string;
  shotId: string | null;
  mode: CaptureMode;
  status: CaptureTakeStatus;
  storageKey: string;
  originalName: string | null;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  frameRate: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  deletedAt?: string | null;
}

export type UpdateCaptureTakeInput = Partial<
  Omit<CreateCaptureTakeInput, "id" | "sessionId" | "projectId" | "createdAt">
>;

/**
 * Every read and write is project-scoped, and the scope is a required argument
 * rather than something the caller remembers. Capture ids are only meaningful
 * inside a project, so a method taking a bare id would make cross-project access
 * a question of discipline instead of something the signature prevents.
 */
export interface CaptureRepository {
  createSession(input: {
    id: string;
    projectId: string;
    createdById: string;
    storyboardId: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<CaptureSessionRecord>;

  getSession(
    projectId: string,
    sessionId: string,
  ): Promise<CaptureSessionRecord | null>;

  updateSession(
    projectId: string,
    sessionId: string,
    changes: {
      status?: CaptureSessionRecord["status"];
      startedAt?: string | null;
      completedAt?: string | null;
      updatedAt: string;
    },
  ): Promise<CaptureSessionRecord>;

  listSessionsByProject(projectId: string): Promise<CaptureSessionRecord[]>;

  createTake(input: CreateCaptureTakeInput): Promise<CaptureTakeRecord>;

  getTake(
    projectId: string,
    takeId: string,
  ): Promise<CaptureTakeRecord | null>;

  getTakeForSession(
    projectId: string,
    sessionId: string,
    takeId: string,
  ): Promise<CaptureTakeRecord | null>;

  updateTake(
    projectId: string,
    takeId: string,
    changes: UpdateCaptureTakeInput,
  ): Promise<CaptureTakeRecord>;

  listTakesBySession(
    projectId: string,
    sessionId: string,
  ): Promise<CaptureTakeRecord[]>;

  listTakesByProject(projectId: string): Promise<CaptureTakeRecord[]>;

  countAcceptedTakes(
    projectId: string,
    sessionId: string,
  ): Promise<number>;

  deleteTake(projectId: string, takeId: string): Promise<void>;
}
