import { adaptationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { adaptationErrorResponse } from "../../../../../../../../lib/multiformat-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/**
 * The adapted caption as plain text.
 *
 * Copy has no artifact on disk — the text is the variant — so this is served
 * directly from the job row rather than from storage.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id: projectId, jobId } = await context.params;

    const text = await adaptationService.getJobText({
      projectId,
      jobId,
      userId: user.id,
    });

    return new Response(text.text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
