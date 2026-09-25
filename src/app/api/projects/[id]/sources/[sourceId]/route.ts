import { inputService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { wrapInputHttpError } from "../../../../../../lib/input-api";

type SourceRouteContext = {
  params: Promise<{ id: string; sourceId: string }>;
};

export async function DELETE(
  request: Request,
  context: SourceRouteContext,
) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);

    const { id, sourceId } = await context.params;

    await inputService.deleteInput(id, user.id, sourceId);

    return Response.json({ ok: true });
  } catch (error) {
    return wrapInputHttpError(error);
  }
}