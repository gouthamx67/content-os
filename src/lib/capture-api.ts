import type { CapturePlanItem, CapturePlanMode } from "../modules/capture-engine/capture-plan";

/**
 * The shape the capture workspace receives.
 *
 * `storageKey` is absent by construction: the client plays back through the
 * membership-checked stream endpoint, so the server-side key is never handed out.
 */
export type SerializedCaptureTake = {
  id: string;
  shotId: string | null;
  mode: string;
  status: string;
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

export type SerializedCapturePlanItem = CapturePlanItem & {
  availableModes: CapturePlanMode[];
};

export type SerializedCaptureSession = {
  id: string;
  projectId: string;
  storyboardId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function serializeCaptureTake(take: {
  id: string;
  shotId: string | null;
  mode: string;
  status: string;
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
}): SerializedCaptureTake {
  return {
    id: take.id,
    shotId: take.shotId,
    mode: take.mode,
    status: take.status,
    mimeType: take.mimeType,
    byteSize: take.byteSize,
    checksumSha256: take.checksumSha256,
    width: take.width,
    height: take.height,
    durationMs: take.durationMs,
    frameRate: take.frameRate,
    metadata: take.metadata,
    createdAt: take.createdAt,
    acceptedAt: take.acceptedAt,
    rejectedAt: take.rejectedAt,
    deletedAt: take.deletedAt,
  };
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs <= 0) {
    return "--:--";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(byteSize: number): string {
  if (byteSize < 1024) { return `${byteSize} B`; }
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export const CAPTURE_MODE_LABELS: Readonly<Record<string, string>> = {
  CAMERA: "Camera",
  MICROPHONE: "Microphone",
  SCREEN: "Screen",
  FILE: "File import",
};
