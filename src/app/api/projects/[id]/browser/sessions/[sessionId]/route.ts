import { browserService } from "../../../../../../../infrastructure/services";
import { serializeSession, serializeStep, wrapBrowserHttpError } from "../../../../../../../lib/browser-api";
import { HttpError } from "../../../../../../../lib/http";
import { requireUser } from "../../../../../../../lib/require-auth";

export const maxDuration = 30;

type SessionRouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/** Session plus its full interaction trace, for the trace viewer. */
export async function GET(request: Request, context: SessionRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;
    const [session, trace] = await Promise.all([
      browserService.getSession(id, sessionId, user.id),
      browserService.getTrace(id, sessionId, user.id),
    ]);
    if (!session) {
      throw new HttpError(404, "Browser session was not found");
    }
    return Response.json({
      session: serializeSession(session),
      trace: trace
        ? { steps: trace.steps.map(serializeStep), startedAt: trace.startedAt, completedAt: trace.completedAt }
        : null,
    });
  } catch (error) {
    return wrapBrowserHttpError(error);
  }
}
