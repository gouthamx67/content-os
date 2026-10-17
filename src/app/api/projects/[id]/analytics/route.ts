import { analyticsService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { publishingErrorResponse } from "../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const overview = await analyticsService.getOverview(user.id, id);
    return Response.json(overview);
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
