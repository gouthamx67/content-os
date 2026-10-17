import { publishingService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { publishingErrorResponse } from "../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * The providers this deployment actually configured, plus the exact reason
 * publishing is unavailable when the secret key is missing. The UI renders the
 * honest state instead of offering actions that cannot work.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const catalog = await publishingService.listProviders(user.id, id);
    return Response.json(catalog);
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
