import { adaptationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError } from "../../../../../../lib/http";
import { adaptationErrorResponse } from "../../../../../../lib/multiformat-http";
import { ADAPTATION_KINDS } from "../../../../../../modules/multiformat-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * The formats a source kind can be adapted into.
 *
 * This is the server's own registry, filtered by kind, with CP09's verdict on the
 * requested platform attached. It exists so a picker never has to hard-code a list
 * of shapes that the engine would then refuse.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id: projectId } = await context.params;

    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    const platformParam = url.searchParams.get("platformId");

    if (kindParam && !ADAPTATION_KINDS.includes(kindParam as never)) {
      throw new HttpError(400, "Unknown adaptation kind");
    }

    const result = await adaptationService.listFormats({
      projectId,
      userId: user.id,
      kind: kindParam ? (kindParam as never) : undefined,
      platformId: platformParam,
    });

    return Response.json(result);
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
