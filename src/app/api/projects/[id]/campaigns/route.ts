import { campaignService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import { campaignErrorResponse } from "../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const campaigns = await campaignService.listCampaigns(user.id, id);

    return Response.json({ campaigns });
  } catch (error) {
    return campaignErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await campaignService.createCampaign({
      userId: user.id,
      projectId: id,
      name: typeof body["name"] === "string" ? body["name"] : "",
      objective: typeof body["objective"] === "string" ? body["objective"] : "",
      audienceSummary:
        typeof body["audienceSummary"] === "string" ? body["audienceSummary"] : "",
      keyMessage: typeof body["keyMessage"] === "string" ? body["keyMessage"] : "",
      brief: body["brief"],
    });

    return Response.json(detail, { status: 201 });
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
