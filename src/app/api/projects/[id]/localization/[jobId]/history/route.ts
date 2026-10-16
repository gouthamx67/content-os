import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  localizationErrorResponse,
  parsePage,
} from "../../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;
    const page = parsePage(new URL(request.url).searchParams);

    const history = await localizationService.listHistory(user.id, id, jobId, page);

    return Response.json(history);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
