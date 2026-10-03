import { imageGenerationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import {
  imageErrorResponse,
  imageGenerationJobView,
} from "../../../../../../lib/image-http";
import type {
  GraphicTemplateType,
  ImageGenerationProvider,
  ImageOutputFormat,
} from "../../../../../../modules/image-generation/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Enqueues one image generation for the project.
 *
 * The prompt, template and optional explicit dimensions are validated by the
 * service. The response is a queued job, not an image: bytes appear only after
 * the worker has rendered and verified them.
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

    const job = await imageGenerationService.enqueue({
      projectId: id,
      requestedById: user.id,
      templateType: body["templateType"] as GraphicTemplateType,
      prompt: typeof body["prompt"] === "string" ? body["prompt"] : "",
      width: typeof body["width"] === "number" ? body["width"] : undefined,
      height: typeof body["height"] === "number" ? body["height"] : undefined,
      outputFormat:
        typeof body["outputFormat"] === "string"
          ? (body["outputFormat"] as ImageOutputFormat)
          : undefined,
      transparent:
        typeof body["transparent"] === "boolean"
          ? body["transparent"]
          : undefined,
      provider:
        typeof body["provider"] === "string"
          ? (body["provider"] as ImageGenerationProvider)
          : undefined,
      intentId: typeof body["intentId"] === "string" ? body["intentId"] : null,
      directionId:
        typeof body["directionId"] === "string" ? body["directionId"] : null,
      storyboardId:
        typeof body["storyboardId"] === "string"
          ? body["storyboardId"]
          : null,
      sceneId: typeof body["sceneId"] === "string" ? body["sceneId"] : null,
      graphicDocumentId:
        typeof body["graphicDocumentId"] === "string"
          ? body["graphicDocumentId"]
          : null,
    });

    return Response.json(
      { imageGenerationJob: imageGenerationJobView(job) },
      { status: 201 },
    );
  } catch (error) {
    return imageErrorResponse(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const jobs = await imageGenerationService.list({
      projectId: id,
      userId: user.id,
    });

    return Response.json({
      imageGenerationJobs: jobs.map(imageGenerationJobView),
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
