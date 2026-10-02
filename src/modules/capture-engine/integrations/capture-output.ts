export interface CaptureOutput {
  takeId: string;
  projectId: string;
  shotId: string | null;
  storageKey: string;
  mimeType: string;
  checksumSha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export type CaptureOutputSource = {
  id: string;
  projectId: string;
  shotId: string | null;
  storageKey: string;
  mimeType: string;
  checksumSha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

/**
 * The boundary later engines consume.
 *
 * CP14–CP23 read captures through this shape rather than through the capture
 * tables, so the capture engine's storage and session concerns never leak into
 * the intelligence or generation layers — and so a take is never mistaken for a
 * CP06 Source. `storageKey` is a server-side key, not a URL: whoever resolves it
 * must go through a membership-checked endpoint.
 */
export function toCaptureOutput(take: CaptureOutputSource): CaptureOutput {
  return {
    takeId: take.id,
    projectId: take.projectId,
    shotId: take.shotId,
    storageKey: take.storageKey,
    mimeType: take.mimeType,
    checksumSha256: take.checksumSha256,
    durationMs: take.durationMs,
    width: take.width,
    height: take.height,
  };
}
