import { creativeDirectorService } from "../../../../../../infrastructure/services";
import { isSameOrigin } from "../../../../../../lib/http";
import {
  creativeRegistry,
  parseGenerateCreativeRequest,
  serializeCreativeDirection,
  wrapCreativeHttpError,
} from "../../../../../../lib/creative-direction-api";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, parseJsonBody } from "../../../../../../lib/http";

export const maxDuration = 90;

type CreativeRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Generate a new run of directions. Earlier runs are kept rather than replaced,
 * so the response carries the run id the caller can come back to.
 */
export async function POST(request: Request, context: CreativeRouteContext) {
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

    const input = parseGenerateCreativeRequest(body);
    const result = await creativeDirectorService.generate({
      projectId: id,
      userId: user.id,
      intentId: input.intentId,
      mode: input.mode,
      count: input.count,
    });

    return Response.json({
      directions: result.directions.map(serializeCreativeDirection),
      run: {
        creativeRunId: result.creativeRunId,
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        // When a model was asked for and could not answer, the panel says so and
        // shows the deterministic set on its own terms rather than implying the
        // first attempt succeeded.
        fallbackFrom: result.fallbackFrom,
        fallbackReason: result.fallbackReason,
      },
      registry: creativeRegistry(),
    });
  } catch (error) {
    return wrapCreativeHttpError(error);
  }
}
