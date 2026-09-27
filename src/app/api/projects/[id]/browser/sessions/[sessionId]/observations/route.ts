import { browserService } from "../../../../../../../../infrastructure/services";
import { serializeObservation, wrapBrowserHttpError } from "../../../../../../../../lib/browser-api";
import { HttpError } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";

export const maxDuration = 30;

type ObservationsRouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/** Compact page state captured around each step of a session. */
export async function GET(request: Request, context: ObservationsRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
    const observations = await browserService.listObservations(
      id,
      sessionId,
      user.id,
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
    );
    if (observations.length === 0) {
      const session = await browserService.getSession(id, sessionId, user.id);
      if (!session) throw new HttpError(404, "Browser session was not found");
    }
    return Response.json({ observations: observations.map(serializeObservation) });
  } catch (error) {
    return wrapBrowserHttpError(error);
  }
}
