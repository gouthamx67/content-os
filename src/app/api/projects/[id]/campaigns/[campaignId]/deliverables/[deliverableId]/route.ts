import { campaignService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../../lib/http";
import {
  campaignErrorResponse,
  requireRevisionNumber,
} from "../../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string; deliverableId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, campaignId, deliverableId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await campaignService.updateDeliverable({
      userId: user.id,
      projectId: id,
      campaignId,
      deliverableId,
      expectedRevisionNumber: requireRevisionNumber(body),
      patch: {
        title: typeof body["title"] === "string" ? body["title"] : undefined,
        platformId: typeof body["platformId"] === "string" ? body["platformId"] : undefined,
        channel: typeof body["channel"] === "string" ? body["channel"] : undefined,
        contentTypeId:
          typeof body["contentTypeId"] === "string" ? body["contentTypeId"] : undefined,
        brief: body["brief"],
        links: body["links"],
        status: typeof body["status"] === "string" ? body["status"] : undefined,
        scheduledFor:
          typeof body["scheduledFor"] === "string" ? body["scheduledFor"] : undefined,
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

    const { id, campaignId, deliverableId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const detail = await campaignService.removeDeliverable({
      userId: user.id,
      projectId: id,
      campaignId,
      deliverableId,
      expectedRevisionNumber: requireRevisionNumber(body),
    });

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
