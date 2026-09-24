import { assetService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { wrapHttpError } from "../../../../../../lib/http";

type AssetRouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

export async function DELETE(
  request: Request,
  context: AssetRouteContext,
) {
  try {
    const { user } = await requireUser(request);

    const { id, assetId } = await context.params;

    await assetService.remove(id, assetId, user.id);

    return Response.json({ ok: true });
  } catch (error) {
    return wrapHttpError(error);
  }
}