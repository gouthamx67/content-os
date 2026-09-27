import { browserService } from "../../../../../../infrastructure/services";
import { serializeSession, wrapBrowserHttpError } from "../../../../../../lib/browser-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 30;

type SessionsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: SessionsRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "25");
    const sessions = await browserService.listSessions(
      id,
      user.id,
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
    );
    return Response.json({ sessions: sessions.map(serializeSession) });
  } catch (error) {
    return wrapBrowserHttpError(error);
  }
}
