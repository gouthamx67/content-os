import { sourceService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { wrapHttpError } from "../../../../../../lib/http";

type SourceRouteContext = {
  params: Promise<{ id: string; sourceId: string }>;
};

export async function DELETE(
  request: Request,
  context: SourceRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id, sourceId } = await context.params;

    await sourceService.remove(id, sourceId, user.id);

    return Response.json({ ok: true });
  } catch (error) {
    return wrapHttpError(error);
  }
}