/**
 * A capture is not successful because the browser produced a blob.
 *
 * The bytes, the metadata, the ownership and the shot linkage all have to
 * survive a fresh read from PostgreSQL and from storage. Anything that only
 * existed in the request handler never existed.
 */

export const CAPTURE_SESSION_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "REVIEW",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CaptureSessionStatus = (typeof CAPTURE_SESSION_STATUSES)[number];

export const CAPTURE_MODES = [
  "CAMERA",
  "MICROPHONE",
  "SCREEN",
  "FILE",
] as const;

export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const CAPTURE_TAKE_STATUSES = [
  "READY",
  "ACCEPTED",
  "REJECTED",
  "DELETED",
] as const;

export type CaptureTakeStatus = (typeof CAPTURE_TAKE_STATUSES)[number];

export function isCaptureMode(value: unknown): value is CaptureMode {
  return (
    typeof value === "string" &&
    (CAPTURE_MODES as readonly string[]).includes(value)
  );
}

export type CaptureTakeRecord = {
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
  acceptedAt: string | null;
  rejectedAt: string | null;
  deletedAt: string | null;
};

export type CaptureSessionRecord = {
  id: string;
  projectId: string;
  createdById: string;
  storyboardId: string | null;
  status: CaptureSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};
