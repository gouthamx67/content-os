import { localizationService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import {
  localizationErrorResponse,
  requireString,
} from "../../../../../lib/localization-http";
import type {
  LocalizationSourceType,
  LocalizationStrategy,
} from "../../../../../modules/localization-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const SOURCE_TYPES: readonly LocalizationSourceType[] = [
  "WRITING_DOCUMENT",
  "EDITOR_DOCUMENT",
  "ADAPTATION_JOB",
  "CAMPAIGN",
];

const STRATEGIES: readonly LocalizationStrategy[] = ["TRANSLATE", "TRANSCREATE"];

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const jobs = await localizationService.listJobs(user.id, id);

    return Response.json({ jobs });
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

    const sourceType = requireString(body, "sourceType");
    if (!SOURCE_TYPES.includes(sourceType as LocalizationSourceType)) {
      throw new HttpError(400, "Unknown sourceType");
    }

    const strategy = requireString(body, "strategy");
    if (!STRATEGIES.includes(strategy as LocalizationStrategy)) {
      throw new HttpError(400, "Unknown strategy");
    }

    const detail = await localizationService.createJob(user.id, id, {
      sourceType: sourceType as LocalizationSourceType,
      sourceId: requireString(body, "sourceId"),
      targetLocale: requireString(body, "targetLocale"),
      strategy: strategy as LocalizationStrategy,
      ...(typeof body["sourceLocale"] === "string"
        ? { sourceLocale: body["sourceLocale"] }
        : {}),
    });

    return Response.json(detail, { status: 201 });
  } catch (error) {
    return localizationErrorResponse(error);
  }
}
