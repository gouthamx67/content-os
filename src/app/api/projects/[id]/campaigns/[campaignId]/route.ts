import { campaignService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  campaignErrorResponse,
  requireRevisionNumber,
} from "../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, campaignId } = await context.params;

    const detail = await campaignService.getCampaign(user.id, id, campaignId);

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

    const detail = await campaignService.updateBrief({
      userId: user.id,
      projectId: id,
      campaignId,
      expectedRevisionNumber: requireRevisionNumber(body),
      patch: {
        name: typeof body["name"] === "string" ? body["name"] : undefined,
        objective: typeof body["objective"] === "string" ? body["objective"] : undefined,
        audienceSummary:
          typeof body["audienceSummary"] === "string" ? body["audienceSummary"] : undefined,
        keyMessage:
          typeof body["keyMessage"] === "string" ? body["keyMessage"] : undefined,
        brief: body["brief"],
      },
    });

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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

    const detail = await campaignService.archiveCampaign({
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
