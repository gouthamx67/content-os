import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { ImageGenerationError } from "../modules/image-generation/errors";
import type {
  GeneratedImageAssetRecord,
  GraphicDocumentRecord,
  ImageGenerationJobRecord,
} from "../modules/image-generation/domain/types";

/**
 * One error shape for every image route.
 *
 * An image failure is either the caller's (an impossible size, a source from
 * another project) or the renderer's. The status carried by the error is reused
 * so a fixable message reaches the client, and the code lets a client branch
 * without matching on English.
 */
export function imageErrorResponse(error: unknown): NextResponse {
  if (error instanceof ImageGenerationError) {
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
 * The wire shape of an image generation job.
 *
 * The frozen `generationRecipe`, storage keys and provider credentials are
 * deliberately absent: the recipe is an internal reproduction document and the
 * storage layout is not the client's business.
 */
export function imageGenerationJobView(job: ImageGenerationJobRecord) {
  return {
    id: job.id,
    projectId: job.projectId,
    graphicDocumentId: job.graphicDocumentId,
    provider: job.provider,
    status: job.status,
    outputFormat: job.outputFormat,
    width: job.width,
    height: job.height,
    transparent: job.transparent,
    prompt: job.prompt,
    recipeSha256: job.recipeSha256,
    progressPct: job.progressPct,
    providerVersion: job.providerVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}

/** The wire shape of a saved design. The graph is the editor's input. */
export function graphicDocumentView(document: GraphicDocumentRecord) {
  return {
    id: document.id,
    projectId: document.projectId,
    name: document.name,
    templateType: document.templateType,
    width: document.width,
    height: document.height,
    outputFormat: document.outputFormat,
    transparent: document.transparent,
    designGraph: JSON.parse(document.designGraph) as unknown,
    designGraphHash: document.designGraphHash,
    contractVersion: document.contractVersion,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

/**
 * The wire shape of a generated asset. Only a stream URL and intrinsic
 * dimensions cross the boundary; the storage key stays on the server.
 */
export function generatedImageAssetView(asset: GeneratedImageAssetRecord) {
  return {
    id: asset.id,
    projectId: asset.projectId,
    generationJobId: asset.generationJobId,
    graphicDocumentId: asset.graphicDocumentId,
    mimeType: asset.mimeType,
    outputFormat: asset.outputFormat,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize,
    checksumSha256: asset.checksumSha256,
    transparent: asset.transparent,
    metadata: asset.metadata ? (JSON.parse(asset.metadata) as unknown) : null,
    createdAt: asset.createdAt,
    streamUrl: `/api/projects/${asset.projectId}/images/assets/${asset.id}/stream`,
  };
}
