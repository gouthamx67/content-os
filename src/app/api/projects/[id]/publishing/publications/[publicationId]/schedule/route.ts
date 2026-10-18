import { publishingService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../../lib/http";
import {
  publishingErrorResponse,
  requireString,
} from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.publishingMutation,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, publicationId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }
    const publication = await publishingService.schedulePublication(
      user.id,
      id,
      publicationId,
      {
        scheduledFor: requireString(body, "scheduledFor"),
        timezone: requireString(body, "timezone"),
      },
    );
    return Response.json({ publication });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
