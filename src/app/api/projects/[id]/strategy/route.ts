import { socialStrategyService } from "../../../../../infrastructure/services";
import { wrapHttpError } from "../../../../../lib/http";
import { requireUser } from "../../../../../lib/require-auth";

type StrategyRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: StrategyRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const strategy = await socialStrategyService.get(user.id, id);
    return Response.json({ strategy });
  } catch (error) {
    return wrapHttpError(error);
  }
}
