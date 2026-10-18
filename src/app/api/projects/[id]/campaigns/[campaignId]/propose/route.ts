import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import { campaignErrorResponse } from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

/**
 * Preview the plan a proposal would produce without writing it. The accepted
 * proposal is only persisted through `POST .../plan`, so an AI suggestion and an
 * approved plan are never the same act.
 */
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

    const proposal = await campaignService.proposePlan(
      user.id,
      id,
      campaignId,
      body["proposal"],
    );

    return Response.json(proposal);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
