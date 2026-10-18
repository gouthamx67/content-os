import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  campaignErrorResponse,
  optionalRevisionNumber,
} from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.aiGeneration,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, campaignId } = await context.params;
    const body = (await parseJsonBody(request)) ?? {};

    const detail = await campaignService.planCampaign({
      userId: user.id,
      projectId: id,
      campaignId,
      expectedRevisionNumber: optionalRevisionNumber(body),
      proposal: body["proposal"],
    });

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
