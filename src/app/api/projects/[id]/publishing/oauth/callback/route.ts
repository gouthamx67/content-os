import { publishingService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  clearStateCookie,
  publishingErrorResponse,
  readStateCookie,
} from "../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * The OAuth redirect target. The signed state travels in an httpOnly cookie
 * scoped to this project's publishing routes and is verified against the user
 * and project before any token exchange; failures redirect back to the
 * workspace with a readable error instead of leaking provider payloads.
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const workspace = new URL(`/projects/${id}/publishing`, request.url);

  try {
    const { user } = await requireUser(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateFromQuery = url.searchParams.get("state");
    const stateToken = readStateCookie(request);

    if (!code || !stateFromQuery || !stateToken || stateFromQuery !== stateToken) {
      throw new Error("missing-oauth-state");
    }

    const redirectUri = new URL(
      `/api/projects/${id}/publishing/oauth/callback`,
      request.url,
    ).toString();

    await publishingService.completeConnection(user.id, id, {
      code,
      stateToken,
      redirectUri,
    });

    workspace.searchParams.set("connected", "1");
    return new Response(null, {
      status: 302,
      headers: {
        Location: workspace.toString(),
        "Set-Cookie": clearStateCookie(id),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "missing-oauth-state") {
      workspace.searchParams.set("publishErrorCode", "PUBLISHING_OAUTH_STATE_INVALID");
      workspace.searchParams.set(
        "publishError",
        "The OAuth state was missing or did not match; start the connection again.",
      );
      return new Response(null, {
        status: 302,
        headers: {
          Location: workspace.toString(),
          "Set-Cookie": clearStateCookie(id),
        },
      });
    }

    const response = publishingErrorResponse(error);
    const payload = (await response.json()) as {
      error?: string;
      code?: string;
    };
    workspace.searchParams.set("publishErrorCode", payload.code ?? "PUBLISHING_OAUTH_EXCHANGE_FAILED");
    workspace.searchParams.set(
      "publishError",
      typeof payload.error === "string" ? payload.error : "The connection failed.",
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: workspace.toString(),
        "Set-Cookie": clearStateCookie(id),
      },
    });
  }
}
