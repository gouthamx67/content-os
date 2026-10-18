import { imageVariantService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  imageErrorResponse,
  imageGenerationJobView,
} from "../../../../../../lib/image-http";
import type { GraphicTemplateType } from "../../../../../../modules/image-generation/domain/types";
import type { ImageVariantSpec } from "../../../../../../modules/image-generation/variants";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Enqueues the standard set of platform variants for one brief.
 *
 * Each variant becomes its own job, so the response is a list of queued jobs.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.aiGeneration,
      user.id,
    );
    if (limited) return limited;
    const { id } = await context.params;

    const body = (await parseJsonBody(request)) ?? {};

    const jobs = await imageVariantService.enqueueVariants({
      projectId: id,
      userId: user.id,
      templateType: body["templateType"] as GraphicTemplateType,
      prompt: typeof body["prompt"] === "string" ? body["prompt"] : "",
      variants: Array.isArray(body["variants"])
        ? (body["variants"] as ImageVariantSpec[])
        : undefined,
    });

    return Response.json(
      { imageGenerationJobs: jobs.map(imageGenerationJobView) },
      { status: 201 },
    );
  } catch (error) {
    return imageErrorResponse(error);
  }
}
