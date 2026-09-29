import { contentIntentService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  contentIntentRegistry,
  parseIntentEditRequest,
  serializeContentIntentView,
  wrapContentIntentHttpError,
} from "../../../../../../lib/content-intent-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 60;

type IntentRouteContext = {
  params: Promise<{ id: string; intentId: string }>;
};

export async function GET(request: Request, context: IntentRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, intentId } = await context.params;
    const view = await contentIntentService.get(id, intentId, user.id);

    return Response.json({
      ...serializeContentIntentView(view),
      registry: contentIntentRegistry(),
    });
  } catch (error) {
    return wrapContentIntentHttpError(error);
  }
}

/**
 * An edit re-validates the whole intent, not just the changed field: raising a
 * duration past what the content type allows is rejected even when the rest of
 * the record was valid when it was written.
 */
export async function PATCH(request: Request, context: IntentRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, intentId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const edit = parseIntentEditRequest(body);
    const view = await contentIntentService.update(id, intentId, user.id, edit);

    return Response.json({
      ...serializeContentIntentView(view),
      registry: contentIntentRegistry(),
    });
  } catch (error) {
    return wrapContentIntentHttpError(error);
  }
}
