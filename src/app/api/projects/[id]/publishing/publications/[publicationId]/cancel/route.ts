import { publishingService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; publicationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, publicationId } = await context.params;
    const publication = await publishingService.cancelPublication(
      user.id,
      id,
      publicationId,
    );
    return Response.json({ publication });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
