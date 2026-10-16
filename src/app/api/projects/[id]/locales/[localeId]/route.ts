import { localizationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import { localizationErrorResponse } from "../../../../../../lib/localization-http";
import type { TextDirection } from "../../../../../../modules/localization-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; localeId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, localeId } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const direction = body["direction"];
    const locale = await localizationService.updateLocale(user.id, id, localeId, {
      ...(typeof body["label"] === "string" ? { label: body["label"] } : {}),
      ...(direction === "LTR" || direction === "RTL"
        ? { direction: direction as TextDirection }
        : {}),
      ...(typeof body["isSource"] === "boolean"
        ? { isSource: body["isSource"] }
        : {}),
      ...(typeof body["isTarget"] === "boolean"
        ? { isTarget: body["isTarget"] }
        : {}),
    });

    return Response.json({ locale });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, localeId } = await context.params;
    const result = await localizationService.removeLocale(user.id, id, localeId);

    return Response.json(result);
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
