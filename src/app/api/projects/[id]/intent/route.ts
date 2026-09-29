import { contentIntentService } from "../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import {
  contentIntentRegistry,
  parseResolveIntentRequest,
  serializeContentIntentView,
  wrapContentIntentHttpError,
} from "../../../../../lib/content-intent-api";
import { requireUser } from "../../../../../lib/require-auth";

export const maxDuration = 60;

type IntentRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Resolve a request into a stored intent. The response carries the registries the
 * editor needs, so the first render after a resolve needs no second round trip.
 */
export async function POST(request: Request, context: IntentRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const input = parseResolveIntentRequest(body);
    const resolved = await contentIntentService.resolve({
      projectId: id,
      userId: user.id,
      request: input.request,
      sourceIds: input.sourceIds,
    });

    return Response.json({
      ...serializeContentIntentView(resolved),
      resolution: {
        aiApplied: resolved.aiApplied,
        aiErrorCode: resolved.aiErrorCode,
        notes: resolved.notes,
      },
      registry: contentIntentRegistry(),
    });
  } catch (error) {
    return wrapContentIntentHttpError(error);
  }
}

export async function GET(request: Request, context: IntentRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const views = await contentIntentService.list(id, user.id);

    return Response.json({
      intents: views.map((view) => serializeContentIntentView(view)),
      registry: contentIntentRegistry(),
    });
  } catch (error) {
    return wrapContentIntentHttpError(error);
  }
}
