import { publishingService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { publishingErrorResponse } from "../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, publicationId } = await context.params;
    const detail = await publishingService.getPublicationDetail(
      user.id,
      id,
      publicationId,
    );
    return Response.json(detail);
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
