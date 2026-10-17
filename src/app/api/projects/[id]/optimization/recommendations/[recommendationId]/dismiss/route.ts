import { optimizationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { publishingErrorResponse } from "../../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; recommendationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }
    const { id, recommendationId } = await context.params;
    const recommendation = await optimizationService.dismiss(
      user.id,
      id,
      recommendationId,
    );
    return Response.json({ recommendation });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
