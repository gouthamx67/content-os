import { socialTrendService } from "../../../../../../infrastructure/services";
import { wrapHttpError } from "../../../../../../lib/http";
import { requireUser } from "../../../../../../lib/require-auth";

type TrendRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: TrendRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const trends = await socialTrendService.get(user.id, id);
    return Response.json({ trends });
  } catch (error) {
    return wrapHttpError(error);
  }
}
