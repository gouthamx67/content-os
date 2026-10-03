import { renderJobService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../lib/http";
import {
  renderErrorResponse as renderError,
  renderJobView,
} from "../../../../../../../lib/render-http";

type RouteContext = {
  params: Promise<{ id: string; renderJobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, renderJobId } = await context.params;

    const job = await renderJobService.cancel({
      projectId: id,
      renderJobId,
      userId: user.id,
    });

    return Response.json({ renderJob: renderJobView(job) });
  } catch (error) {
    return renderError(error);
  }
}
