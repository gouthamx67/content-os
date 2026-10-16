import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  localizationErrorResponse,
  requireRevisionNumber,
  requireString,
} from "../../../../../../../lib/localization-http";
import type { ReviewDecision } from "../../../../../../../modules/localization-engine/services/localization-service";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

const DECISIONS: readonly ReviewDecision[] = ["APPROVE", "REQUEST_CHANGES"];

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

    const decision = requireString(body, "decision");
    if (!DECISIONS.includes(decision as ReviewDecision)) {
      throw new HttpError(400, "Unknown review decision");
    }

    const detail = await localizationService.review(user.id, id, jobId, {
      expectedRevisionNumber: requireRevisionNumber(body),
      decision: decision as ReviewDecision,
    });

    return Response.json(detail);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
