import { writingGenerationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import {
  writingErrorResponse,
  writingJobView,
} from "../../../../../../lib/writing-http";
import type {
  WritingBlockType,
  WritingLength,
  WritingObjective,
  WritingProvider,
  WritingTone,
} from "../../../../../../modules/writing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Enqueues one writing generation for the project.
 *
 * The block type, tone, length and objective are validated by the service. The
 * response is a queued job, not copy: variants appear only after the worker has
 * generated and grounded them against the frozen context.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const job = await writingGenerationService.enqueue({
      projectId: id,
      requestedById: user.id,
      blockType: body["blockType"] as WritingBlockType,
      tone: (typeof body["tone"] === "string" ? body["tone"] : "BRAND") as WritingTone,
      length: (typeof body["length"] === "string"
        ? body["length"]
        : "MEDIUM") as WritingLength,
      objective:
        typeof body["objective"] === "string"
          ? (body["objective"] as WritingObjective)
          : undefined,
      audience: typeof body["audience"] === "string" ? body["audience"] : null,
      language: typeof body["language"] === "string" ? body["language"] : null,
      prompt: typeof body["prompt"] === "string" ? body["prompt"] : "",
      variantCount:
        typeof body["variantCount"] === "number"
          ? body["variantCount"]
          : undefined,
      provider:
        typeof body["provider"] === "string"
          ? (body["provider"] as WritingProvider)
          : undefined,
      intentId: typeof body["intentId"] === "string" ? body["intentId"] : null,
      directionId:
        typeof body["directionId"] === "string" ? body["directionId"] : null,
      storyboardId:
        typeof body["storyboardId"] === "string"
          ? body["storyboardId"]
          : null,
      sceneId: typeof body["sceneId"] === "string" ? body["sceneId"] : null,
    });

    return Response.json(
      { writingGenerationJob: writingJobView(job) },
      { status: 201 },
    );
  } catch (error) {
    return writingErrorResponse(error);
  }
}
