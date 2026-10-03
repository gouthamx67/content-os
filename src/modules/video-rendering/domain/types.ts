export const RENDER_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
] as const;
export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const RENDER_OUTPUT_FORMATS = ["MP4"] as const;
export type RenderOutputFormat = (typeof RENDER_OUTPUT_FORMATS)[number];

export type RenderJobRecord = {
  id: string;
  projectId: string;
  compositionId: string;
  requestedById: string;
  status: RenderJobStatus;
  outputFormat: RenderOutputFormat;
  contractVersion: number;
  sceneGraph: string;
  sceneSha256: string;
  progressPct: number;
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  ffmpegVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type RenderArtifactRecord = {
  id: string;
  renderJobId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
};

export function isRenderJobStatus(value: unknown): value is RenderJobStatus {
  return (
    typeof value === "string" &&
    (RENDER_JOB_STATUSES as readonly string[]).includes(value)
  );
}
