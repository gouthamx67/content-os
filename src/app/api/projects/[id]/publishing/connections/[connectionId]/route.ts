import { publishingService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { PublishingError } from "../../../../../../../modules/publishing-engine/errors";
import { publishingErrorResponse } from "../../../../../../../lib/publishing-http";

type RouteContext = {
  params: Promise<{ id: string; connectionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, connectionId } = await context.params;
    const connections = await publishingService.listConnections(user.id, id);
    const connection = connections.find((entry) => entry.id === connectionId);
    if (!connection) {
      throw new PublishingError(
        "CONNECTION_NOT_FOUND",
        `Publishing connection ${connectionId} was not found in this project.`,
      );
    }
    return Response.json({ connection });
  } catch (error) {
    return publishingErrorResponse(error);
  }
}
