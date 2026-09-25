import { NextResponse } from "next/server";
import { generationService, projectService } from "../../../../infrastructure/services";
import { requireUser } from "../../../../lib/require-auth";
import { wrapHttpError } from "../../../../lib/http";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const job = await generationService.getJob(id);

    if (!job) {
      return NextResponse.json(
        {
          error: "Job not found",
        },
        {
          status: 404,
        },
      );
    }

    await projectService.getAuthorized(job.projectId, user.id);

    return NextResponse.json({
      job,
    });
  } catch (error) {
    return wrapHttpError(error);
  }
}
