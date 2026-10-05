import { NextResponse } from "next/server";
import { HttpError } from "./http";
import { WritingError } from "../modules/writing-engine/errors";
import type {
  WritingClaimRecord,
  WritingDocumentRecord,
  WritingGenerationJobRecord,
  WritingVariantRecord,
} from "../modules/writing-engine/domain/types";

/**
 * One error shape for every writing route.
 *
 * A writing failure is either the caller's (an unsupported length, a source from
 * another project) or the engine's. The status carried by the error is reused so
 * a fixable message reaches the client, and the code lets a client branch
 * without matching on English.
 */
export function writingErrorResponse(error: unknown): NextResponse {
  if (error instanceof WritingError) {
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
 * The wire shape of a writing job.
 *
 * The frozen `generationRecipe` and `contextSnapshot` are deliberately absent:
 * they are internal reproduction documents, and returning them would expose the
 * whole project graph to any member who can read a job.
 */
export function writingJobView(job: WritingGenerationJobRecord) {
  return {
    id: job.id,
    projectId: job.projectId,
    documentId: job.documentId,
    provider: job.provider,
    status: job.status,
    blockType: job.blockType,
    tone: job.tone,
    length: job.length,
    objective: job.objective,
    audience: job.audience,
    language: job.language,
    prompt: job.prompt,
    recipeSha256: job.recipeSha256,
    contextSha256: job.contextSha256,
    variantCount: job.variantCount,
    progressPct: job.progressPct,
    providerModel: job.providerModel,
    providerVersion: job.providerVersion,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}

export function writingVariantView(variant: WritingVariantRecord) {
  return {
    id: variant.id,
    documentId: variant.documentId,
    ordinal: variant.ordinal,
    label: variant.label,
    text: variant.text,
    textSha256: variant.textSha256,
    instruction: variant.instruction,
    selected: variant.selected,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

export function writingClaimView(claim: WritingClaimRecord) {
  return {
    id: claim.id,
    projectId: claim.projectId,
    documentId: claim.documentId,
    variantId: claim.variantId,
    text: claim.text,
    status: claim.status,
    sourceIds: claim.sourceIds,
    reasoning: claim.reasoning,
    createdAt: claim.createdAt,
  };
}

export function writingDocumentView(document: WritingDocumentRecord) {
  return {
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    blockType: document.blockType,
    tone: document.tone,
    length: document.length,
    objective: document.objective,
    audience: document.audience,
    language: document.language,
    content: document.content,
    contentSha256: document.contentSha256,
    contextSha256: document.contextSha256,
    version: document.version,
    brandVersion: document.brandVersion,
    intelligenceVersion: document.intelligenceVersion,
    intentId: document.intentId,
    directionId: document.directionId,
    storyboardId: document.storyboardId,
    sceneId: document.sceneId,
    selectedVariantId: document.selectedVariantId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function writingDocumentDetailView(view: {
  document: WritingDocumentRecord;
  variants: WritingVariantRecord[];
  claims: WritingClaimRecord[];
}) {
  return {
    document: writingDocumentView(view.document),
    variants: view.variants.map(writingVariantView),
    claims: view.claims.map(writingClaimView),
  };
}
