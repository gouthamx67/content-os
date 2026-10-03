import { renderJobService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  renderErrorResponse as renderError,
  renderJobView,
} from "../../../../../../../../lib/render-http";

type RouteContext = {
  params: Promise<{ id: string; compositionId: string }>;
};

/**
 * Enqueues a render of the current composition.
 *
 * The response is a job, not a file: rendering is long-running and belongs to a
 * separate process, so the client polls the job and downloads the artifact when
 * it is ready.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const job = await renderJobService.enqueue({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json({ renderJob: renderJobView(job) }, { status: 201 });
  } catch (error) {
    return renderError(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, compositionId } = await context.params;

    const jobs = await renderJobService.list({
      projectId: id,
      compositionId,
      userId: user.id,
    });

    return Response.json({ renderJobs: jobs.map(renderJobView) });
  } catch (error) {
    return renderError(error);
  }
}
