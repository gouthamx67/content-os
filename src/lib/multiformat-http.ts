import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { AdaptationError } from "../modules/multiformat-engine/errors";
import { parseRecipe } from "../modules/multiformat-engine/recipe/hash-recipe";
import type {
  AdaptationBatchRecord,
  AdaptationJobRecord,
} from "../modules/multiformat-engine/domain/types";

/**
 * One error shape for every adaptation route.
 *
 * The status the domain error chose is reused so a fixable message reaches the
 * caller, and the code lets a client branch without matching English.
 */
export function adaptationErrorResponse(error: unknown): NextResponse {
  if (error instanceof AdaptationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

/**
 * The wire shape of an adaptation batch.
 *
 * The frozen `sourceSnapshot` is deliberately withheld. It contains the source's
 * full text or its whole layer graph — internal reproduction material that no
 * caller needs to render a variant card, and that would hand the entire project
 * graph to anyone who can read a batch.
 */
export function adaptationBatchView(batch: AdaptationBatchRecord) {
  return {
    id: batch.id,
    projectId: batch.projectId,
    sourceType: batch.sourceType,
    sourceId: batch.sourceId,
    sourceSha256: batch.sourceSha256,
    targetCount: batch.targetCount,
    status: batch.status,
    progressPct: batch.progressPct,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    finishedAt: batch.finishedAt,
  };
}

/**
 * The wire shape of an adaptation job.
 *
 * `recipe` is withheld for the same reason as the snapshot. `provenanceSourceIds`
 * is included deliberately: those are CP06 source ids, and a viewer has to be able
 * to show what a caption was built from.
 */
export function adaptationJobView(job: AdaptationJobRecord) {
  return {
    id: job.id,
    batchId: job.batchId,
    projectId: job.projectId,
    platformId: job.platformId || null,
    formatId: job.formatId,
    kind: job.kind,
    recipeSha256: job.recipeSha256,
    provenanceSourceIds: provenanceOf(job),
    status: job.status,
    progressPct: job.progressPct,
    outputText: job.outputText,
    outputMimeType: job.outputMimeType,
    outputByteSize: job.outputByteSize,
    outputChecksumSha256: job.outputChecksumSha256,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    renderJobId: job.renderJobId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * The CP06 sources a variant was built from, read out of its frozen recipe.
 *
 * A row whose recipe will not parse reports no provenance rather than failing the
 * whole listing: one unreadable job should not hide every other variant on the
 * page.
 */
function provenanceOf(job: AdaptationJobRecord): string[] {
  try {
    return parseRecipe(job.recipe).provenanceSourceIds;
  } catch {
    return [];
  }
}

export function adaptationBatchDetailView(view: {
  batch: AdaptationBatchRecord;
  jobs: AdaptationJobRecord[];
}) {
  return {
    batch: adaptationBatchView(view.batch),
    jobs: view.jobs.map(adaptationJobView),
  };
}
