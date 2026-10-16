import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
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
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, jobId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await localizationService.validate(
      user.id,
      id,
      jobId,
      requireRevisionNumber(body),
    );

    return Response.json(detail);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
