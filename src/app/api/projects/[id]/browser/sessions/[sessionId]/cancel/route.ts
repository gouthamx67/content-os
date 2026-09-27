import { browserService } from "../../../../../../../../infrastructure/services";
import { serializeSession, wrapBrowserHttpError } from "../../../../../../../../lib/browser-api";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";

export const maxDuration = 30;

type CancelRouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

export async function POST(request: Request, context: CancelRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;
    const session = await browserService.cancelSession(id, sessionId, user.id);
    if (!session) {
      throw new HttpError(404, "Browser session was not found");
    }
    return Response.json({ session: serializeSession(session) });
  } catch (error) {
    return wrapBrowserHttpError(error);
  }
}
