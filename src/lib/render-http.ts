import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { VisualValidationError } from "../modules/visual-motion-engine/domain/validation";
import { RenderError } from "../modules/video-rendering/errors";
import type {
  RenderArtifactRecord,
  RenderJobRecord,
} from "../modules/video-rendering/domain/types";

/**
 * One error shape for every render route.
 *
 * A render failure is either the caller's (an asset from another project, a
 * layer type the compiler cannot draw) or the renderer's. The status already
 * carried by the error is reused so a fixable message reaches the client.
 */
export function renderErrorResponse(error: unknown): NextResponse {
  if (error instanceof RenderError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof VisualValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

/**
 * The wire shape of a render job.
 *
 * `sceneGraph` and any storage key are deliberately absent: the snapshot can be
 * large and the storage layout is not the client's business. The client gets an
 * id it can poll and a download URL it can follow.
 */
export function renderJobView(job: RenderJobRecord) {
  return {
    id: job.id,
    projectId: job.projectId,
    compositionId: job.compositionId,
    status: job.status,
    outputFormat: job.outputFormat,
    progressPct: job.progressPct,
    contractVersion: job.contractVersion,
    sceneSha256: job.sceneSha256,
    width: job.width,
    height: job.height,
    frameRate: job.frameRate,
    durationMs: job.durationMs,
    ffmpegVersion: job.ffmpegVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}

export function renderArtifactView(artifact: RenderArtifactRecord) {
  return {
    id: artifact.id,
    renderJobId: artifact.renderJobId,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    checksumSha256: artifact.checksumSha256,
    createdAt: artifact.createdAt,
    downloadUrl: `/api/projects/${artifact.projectId}/renders/${artifact.renderJobId}/stream`,
  };
}
