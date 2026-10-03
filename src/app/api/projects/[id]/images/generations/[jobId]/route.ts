import { imageGenerationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  generatedImageAssetView,
  imageErrorResponse,
  imageGenerationJobView,
} from "../../../../../../../lib/image-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/**
 * Reads one job and, once it has succeeded, the asset it produced.
 *
 * Reading is authorised through the job first, so an asset id from another
 * project can never be fetched by guessing.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;

    const job = await imageGenerationService.get({
      projectId: id,
      jobId,
      userId: user.id,
    });

    const asset = await imageGenerationService.asset({
      projectId: id,
      jobId,
      userId: user.id,
    });

    return Response.json({
      imageGenerationJob: imageGenerationJobView(job),
      asset: asset ? generatedImageAssetView(asset) : null,
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
