import { visualCompositionService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { visualErrorResponse as visualError } from "../../../../../../lib/visual-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Brand colours and fonts a new composition can start from.
 *
 * Deliberately a read-through of CP08 rather than a copy: this endpoint exists so
 * the visual workspace can offer the current brand values without owning them.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const defaults = await visualCompositionService.visualDefaults({
      projectId: id,
      userId: user.id,
    });

    return Response.json({ defaults });
  } catch (error) {
    return visualError(error);
  }
}
