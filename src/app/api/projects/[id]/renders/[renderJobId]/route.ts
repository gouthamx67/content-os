import { renderJobService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  renderArtifactView,
  renderErrorResponse as renderError,
  renderJobView,
} from "../../../../../../lib/render-http";

type RouteContext = {
  params: Promise<{ id: string; renderJobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, renderJobId } = await context.params;

    const job = await renderJobService.get({
      projectId: id,
      renderJobId,
      userId: user.id,
    });

    const artifact = await renderJobService.artifact({
      projectId: id,
      renderJobId,
      userId: user.id,
    });

    return Response.json({
      renderJob: renderJobView(job),
      artifact: artifact ? renderArtifactView(artifact) : null,
    });
  } catch (error) {
    return renderError(error);
  }
}
