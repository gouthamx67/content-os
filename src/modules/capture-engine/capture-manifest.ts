import type { CaptureTakeRecord } from "./capture-types";

export interface CaptureManifestTake {
  id: string;
  shotId: string | null;
  mode: string;
  status: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  metadata: Record<string, unknown> | null;
}

export interface CaptureManifest {
  version: 1;
  sessionId: string;
  projectId: string;
  generatedAt: string;
  takes: CaptureManifestTake[];
}

/**
 * The manifest is generated only from persisted records. That is the difference
 * between a read that proves state survived a refresh and a "live" object still
 * cached in memory.
 */
export function buildCaptureManifest(input: {
  sessionId: string;
  projectId: string;
  takes: CaptureTakeRecord[];
  generatedAt?: Date;
}): CaptureManifest {
  const at = input.generatedAt ?? new Date();

  return {
    version: 1,
    sessionId: input.sessionId,
    projectId: input.projectId,
    generatedAt: at.toISOString(),
    takes: input.takes.map((take) => ({
      id: take.id,
      shotId: take.shotId,
      mode: take.mode,
      status: take.status,
      mimeType: take.mimeType,
      byteSize: take.byteSize,
      checksumSha256: take.checksumSha256,
      durationMs: take.durationMs,
      width: take.width,
      height: take.height,
      frameRate: take.frameRate,
      metadata: take.metadata,
    })),
  };
}
