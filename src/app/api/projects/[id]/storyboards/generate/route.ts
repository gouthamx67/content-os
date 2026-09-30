import { storyboardService } from "../../../../../../infrastructure/services";
import { isSameOrigin, HttpError, parseJsonBody } from "../../../../../../lib/http";
import {
  parseGenerateStoryboardRequest,
  serializeStoryboard,
  storyboardRegistry,
  wrapStoryboardHttpError,
} from "../../../../../../lib/storyboard-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 90;

type GenerateRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Plans a storyboard for a chosen direction. Earlier plans are kept rather than
 * replaced, so the response names the plan it made and the panel can offer both.
 *
 * The response carries the capture list alongside the plan because the two are
 * read together: a scene that wants a screen captured is not actionable without
 * the list of what to capture.
 */
export async function POST(request: Request, context: GenerateRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const input = parseGenerateStoryboardRequest(body);
    const result = await storyboardService.generate({
      projectId: id,
      userId: user.id,
      intentId: input.intentId,
      directionId: input.directionId,
      ...(input.targetDurationMs !== undefined
        ? { targetDurationMs: input.targetDurationMs }
        : {}),
    });

    return Response.json({
      storyboard: serializeStoryboard(result.storyboard),
      captureTargets: result.captureTargets,
      generation: {
        provider: result.provider,
        model: result.model,
        // When a model was asked for and could not answer, the panel says so and
        // shows the deterministic plan on its own terms rather than implying the
        // first attempt succeeded.
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason,
      },
      registry: storyboardRegistry(),
    });
  } catch (error) {
    return wrapStoryboardHttpError(error);
  }
}
