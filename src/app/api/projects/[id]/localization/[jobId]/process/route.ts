import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  localizationErrorResponse,
  requireRevisionNumber,
} from "../../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.localizationProcess,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, jobId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await localizationService.process(user.id, id, jobId, {
      expectedRevisionNumber: requireRevisionNumber(body),
      ...(typeof body["provider"] === "string"
        ? { provider: body["provider"] }
        : {}),
    });

    return Response.json(detail);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
