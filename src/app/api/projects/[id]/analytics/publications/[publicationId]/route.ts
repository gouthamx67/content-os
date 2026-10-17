import { analyticsService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { publishingErrorResponse } from "../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, publicationId } = await context.params;
    const history = await analyticsService.getPublicationHistory(
      user.id,
      id,
      publicationId,
    );
    return Response.json(history);
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
