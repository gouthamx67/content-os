import { imageGenerationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  imageErrorResponse,
  imageGenerationJobView,
} from "../../../../../../lib/image-http";
import type { ImageGenerationJobStatus } from "../../../../../../modules/image-generation/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Lists generation jobs for the project, optionally filtered by document. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const documentId = url.searchParams.get("graphicDocumentId");

    const jobs = await imageGenerationService.list({
      projectId: id,
      userId: user.id,
      status: statusParam
        ? (statusParam as ImageGenerationJobStatus)
        : undefined,
      graphicDocumentId: documentId ?? undefined,
    });

    return Response.json({
      imageGenerationJobs: jobs.map(imageGenerationJobView),
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
