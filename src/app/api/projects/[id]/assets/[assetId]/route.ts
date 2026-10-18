import { assetService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, wrapHttpError } from "../../../../../../lib/http";

type AssetRouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

export async function DELETE(
  request: Request,
  context: AssetRouteContext,
) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, assetId } = await context.params;

    await assetService.remove(id, assetId, user.id);

    return Response.json({ ok: true });
  } catch (error) {
    return wrapHttpError(error);
  }
}