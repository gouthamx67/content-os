import { localizationProviders } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { localizationErrorResponse } from "../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireUser(request);
    await context.params;
    return Response.json({ providers: localizationProviders.names() });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
