import { localizationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { localizationErrorResponse } from "../../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, jobId } = await context.params;

    const exported = await localizationService.exportArtifact(user.id, id, jobId);

    return new Response(exported.json, {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
