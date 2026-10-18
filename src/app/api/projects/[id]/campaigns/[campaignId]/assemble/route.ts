import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import { campaignErrorResponse } from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.renderDispatch,
      user.id,
    );
    if (limited) return limited;
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, campaignId } = await context.params;

    const assembled = await campaignService.assemble(user.id, id, campaignId);

    return Response.json({
      campaign: assembled.campaign,
      hash: assembled.hash,
      kit: assembled.kit,
    });
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
