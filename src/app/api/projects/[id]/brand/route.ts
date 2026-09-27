import { brandService } from "../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import {
  parseBrandUpdateRequest,
  serializeBrandProfile,
  serializeBrandSourceStates,
  wrapBrandHttpError,
} from "../../../../../lib/brand-api";
import { requireUser } from "../../../../../lib/require-auth";

export const maxDuration = 60;

type BrandRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: BrandRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const view = await brandService.getProfile(id, user.id);

    return Response.json({
      brand: view.profile ? serializeBrandProfile(view.profile) : null,
      execution: view.execution,
      sourceStates: serializeBrandSourceStates(view.sourceStates),
    });
  } catch (error) {
    return wrapBrandHttpError(error);
  }
}

export async function PATCH(request: Request, context: BrandRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const update = parseBrandUpdateRequest(body);
    const profile = await brandService.update(id, user.id, update);

    return Response.json({ brand: serializeBrandProfile(profile) });
  } catch (error) {
    return wrapBrandHttpError(error);
  }
}
