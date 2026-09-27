import { brandService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import {
  serializeBrandProfile,
  wrapBrandHttpError,
} from "../../../../../../lib/brand-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 30;

type UnlockRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: UnlockRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const profile = await brandService.setLock(id, user.id, false);

    return Response.json({ brand: serializeBrandProfile(profile) });
  } catch (error) {
    return wrapBrandHttpError(error);
  }
}
