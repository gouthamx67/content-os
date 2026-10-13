import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  campaignErrorResponse,
  requireRevisionNumber,
} from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, campaignId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await campaignService.returnToPlanning({
      userId: user.id,
      projectId: id,
      campaignId,
      expectedRevisionNumber: requireRevisionNumber(body),
    });

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
