import { publishingService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  publishStateMaxAgeSeconds,
  publishingErrorResponse,
  requireString,
  serializeStateCookie,
} from "../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const connections = await publishingService.listConnections(user.id, id);
    return Response.json({ connections });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}

/**
 * Starts an OAuth connection. The redirect URI is derived from this request's
 * own origin, never from client input, so the authorization let alone the token
 * exchange can only come back to this deployment. The signed state travels in
 * an httpOnly cookie scoped to this project's publishing routes.
 */
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
    const providerId = requireString(body, "providerId");
    const redirectUri = new URL(
      `/api/projects/${id}/publishing/oauth/callback`,
      request.url,
    ).toString();

    const started = await publishingService.startConnection(user.id, id, {
      providerId,
      redirectUri,
    });

    return Response.json(
      { authorizationUrl: started.authorizationUrl },
      {
        status: 201,
        headers: {
          "Set-Cookie": serializeStateCookie(
            started.stateToken,
            id,
            publishStateMaxAgeSeconds(),
          ),
        },
      },
    );
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
