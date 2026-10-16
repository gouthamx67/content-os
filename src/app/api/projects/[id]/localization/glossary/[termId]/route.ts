import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import { localizationErrorResponse } from "../../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string; termId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, termId } = await context.params;
    const result = await localizationService.removeGlossaryTerm(user.id, id, termId);

    return Response.json(result);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
