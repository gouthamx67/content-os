import { captureService } from "../../../../../../infrastructure/services";
import { captureErrorResponse as captureError } from "../../../../../../lib/capture-http";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { requireUser } from "../../../../../../lib/require-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Creates a capture session for a project.
 *
 * The body may name a storyboard and nothing else. Ownership, creator and status
 * are all derived: the project is the route's own, the creator is the caller's
 * session user, and a session begins in DRAFT and is started by a separate call.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;

    const text = await request.text();
    let storyboardId: string | null = null;

    if (text.trim().length > 0) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, "Request body must be JSON");
      }

      if (typeof body !== "object" || body === null) {
        throw new HttpError(400, "Request body must be a JSON object");
      }

      const candidate = (body as Record<string, unknown>)["storyboardId"];

      if (candidate !== undefined && candidate !== null) {
        if (typeof candidate !== "string" || candidate.length === 0) {
          throw new HttpError(400, "storyboardId must be a string");
        }
        storyboardId = candidate;
      }
    }

    const session = await captureService.createSession({
      projectId: id,
      userId: user.id,
      storyboardId,
    });

    return Response.json(
      {
        session: {
          id: session.id,
          projectId: session.projectId,
          storyboardId: session.storyboardId,
          status: session.status,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return captureError(error);
  }
}

