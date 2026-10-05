import { writingGenerationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  writingDocumentView,
  writingErrorResponse,
  writingJobView,
} from "../../../../../../../lib/writing-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/** Reads one job and, once it has succeeded, the document it produced. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;

    const job = await writingGenerationService.getJob({
      projectId: id,
      jobId,
      userId: user.id,
    });

    const document = job.documentId
      ? await writingGenerationService
          .getDocument({ projectId: id, documentId: job.documentId, userId: user.id })
          .catch(() => null)
      : null;

    return Response.json({
      writingGenerationJob: writingJobView(job),
      documentId: job.documentId,
      document: document ? writingDocumentView(document.document) : null,
    });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
