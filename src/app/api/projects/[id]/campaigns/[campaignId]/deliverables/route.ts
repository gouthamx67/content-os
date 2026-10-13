import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  campaignErrorResponse,
  requireRevisionNumber,
  requireString,
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

    const detail = await campaignService.addDeliverable({
      userId: user.id,
      projectId: id,
      campaignId,
      expectedRevisionNumber: requireRevisionNumber(body),
      title: requireString(body, "title"),
      platformId: requireString(body, "platformId"),
      channel: typeof body["channel"] === "string" ? body["channel"] : null,
      contentTypeId:
        typeof body["contentTypeId"] === "string" ? body["contentTypeId"] : null,
      brief: body["brief"],
      links: body["links"],
      scheduledFor:
        typeof body["scheduledFor"] === "string" ? body["scheduledFor"] : null,
    });

    return Response.json(detail, { status: 201 });
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
