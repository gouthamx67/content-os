import { localizationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  localizationErrorResponse,
  requireString,
} from "../../../../../../lib/localization-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const sourceLocale = params.get("sourceLocale");
    const targetLocale = params.get("targetLocale");
    if (!sourceLocale || !targetLocale) {
      throw new HttpError(400, "sourceLocale and targetLocale are required");
    }

    const terms = await localizationService.listGlossary(
      user.id,
      id,
      sourceLocale,
      targetLocale,
    );

    return Response.json({ terms });
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

    const term = await localizationService.addGlossaryTerm(user.id, id, {
      sourceLocale: requireString(body, "sourceLocale"),
      targetLocale: requireString(body, "targetLocale"),
      term: requireString(body, "term"),
      translation: requireString(body, "translation"),
      ...(typeof body["doNotTranslate"] === "boolean"
        ? { doNotTranslate: body["doNotTranslate"] }
        : {}),
    });

    return Response.json({ term }, { status: 201 });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
