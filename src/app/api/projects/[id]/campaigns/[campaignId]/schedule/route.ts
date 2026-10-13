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

    const entries = parseEntries(body["entries"]);

    const detail = await campaignService.schedule({
      userId: user.id,
      projectId: id,
      campaignId,
      expectedRevisionNumber: requireRevisionNumber(body),
      entries,
    });

    return Response.json(detail);
  } catch (error) {
    return campaignErrorResponse(error);
  }
}

function parseEntries(value: unknown): { deliverableId: string; scheduledFor: string }[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "entries must be an array");
  }
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new HttpError(400, "Each schedule entry must be an object");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record["deliverableId"] !== "string") {
      throw new HttpError(400, "Each schedule entry needs a deliverableId");
    }
    if (typeof record["scheduledFor"] !== "string") {
      throw new HttpError(400, "Each schedule entry needs a scheduledFor");
    }
    return {
      deliverableId: record["deliverableId"],
      scheduledFor: record["scheduledFor"],
    };
  });
}
