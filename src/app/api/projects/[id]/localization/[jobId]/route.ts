import { localizationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { localizationErrorResponse } from "../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;

    const detail = await localizationService.getDetail(user.id, id, jobId);

    return Response.json(detail);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
