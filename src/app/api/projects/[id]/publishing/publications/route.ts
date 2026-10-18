import { publishingService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  publishingErrorResponse,
  requireString,
} from "../../../../../../lib/publishing-http";
import type {
  PublicationSourceType,
  PublicationStatus,
} from "../../../../../../modules/publishing-engine/domain/types";
import { PUBLICATION_STATUSES } from "../../../../../../modules/publishing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const SOURCE_TYPES: readonly PublicationSourceType[] = [
  "WRITING_DOCUMENT",
  "CAMPAIGN_DELIVERABLE",
];

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.publishingMutation,
      user.id,
    );
    if (limited) return limited;
    const { id } = await context.params;
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const sourceType = url.searchParams.get("sourceType");
    const publications = await publishingService.listPublications(user.id, id, {
      ...(status && PUBLICATION_STATUSES.includes(status as PublicationStatus)
        ? { status: status as PublicationStatus }
        : {}),
      ...(sourceType && SOURCE_TYPES.includes(sourceType as PublicationSourceType)
        ? { sourceType: sourceType as PublicationSourceType }
        : {}),
      ...(url.searchParams.get("sourceId")
        ? { sourceId: url.searchParams.get("sourceId")! }
        : {}),
    });
    return Response.json({ publications });
  } catch (error) {
    return publishingErrorResponse(error);
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
    const sourceType = requireString(body, "sourceType");
    if (!SOURCE_TYPES.includes(sourceType as PublicationSourceType)) {
      throw new HttpError(400, "Unknown sourceType");
    }
    const publication = await publishingService.createPublication(user.id, id, {
      connectionId: requireString(body, "connectionId"),
      sourceType: sourceType as PublicationSourceType,
      sourceId: requireString(body, "sourceId"),
    });
    return Response.json({ publication }, { status: 201 });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
