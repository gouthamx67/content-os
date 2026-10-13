import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { campaignErrorResponse } from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, campaignId } = await context.params;

    const readiness = await campaignService.readiness(user.id, id, campaignId);

    return Response.json(readiness);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
