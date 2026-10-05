import { writingGenerationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  writingErrorResponse,
  writingJobView,
} from "../../../../../../lib/writing-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Lists the project's writing jobs, newest first. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const jobs = await writingGenerationService.listJobs({
      projectId: id,
      userId: user.id,
    });

    return Response.json({ writingGenerationJobs: jobs.map(writingJobView) });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
