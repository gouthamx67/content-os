import { localizationService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import {
  localizationErrorResponse,
  requireString,
} from "../../../../../lib/localization-http";
type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const locales = await localizationService.listLocales(user.id, id);
    return Response.json({ locales });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const locale = await localizationService.addLocale(user.id, id, {
      locale: requireString(body, "locale"),
      ...(typeof body["label"] === "string" ? { label: body["label"] } : {}),
      ...(body["direction"] === "LTR" || body["direction"] === "RTL"
        ? { direction: body["direction"] }
        : {}),
      ...(typeof body["isSource"] === "boolean" ? { isSource: body["isSource"] } : {}),
      ...(typeof body["isTarget"] === "boolean" ? { isTarget: body["isTarget"] } : {}),
    });

    return Response.json({ locale }, { status: 201 });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
