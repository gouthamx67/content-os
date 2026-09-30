import { creativeDirectorService } from "../../../../../infrastructure/services";
import {
  creativeRegistry,
  serializeCreativeDirection,
  wrapCreativeHttpError,
} from "../../../../../lib/creative-direction-api";
import { requireUser } from "../../../../../lib/require-auth";
import { CreativeDirectionStatus } from "../../../../../core/domain/creative-direction";

type CreativeRouteContext = {
  params: Promise<{ id: string }>;
};

/** Every run stored for this project, newest first. */
export async function GET(request: Request, context: CreativeRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const url = new URL(request.url);

    const intentId = url.searchParams.get("intentId") ?? undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam
      ? (statusParam.toUpperCase() as CreativeDirectionStatus)
      : undefined;

    const directions = await creativeDirectorService.list(id, user.id, {
      ...(intentId ? { intentId } : {}),
      ...(status ? { status } : {}),
    });

    return Response.json({
      directions: directions.map(serializeCreativeDirection),
      registry: creativeRegistry(),
    });
  } catch (error) {
    return wrapCreativeHttpError(error);
  }
}
