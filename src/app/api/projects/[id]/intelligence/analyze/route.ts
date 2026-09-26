import { intelligenceService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  parseSourceIds,
  wrapIntelligenceHttpError,
} from "../../../../../../lib/intelligence-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 300;

type AnalyzeRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: AnalyzeRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = (await parseJsonBody(request)) ?? {};
    const sourceIds = parseSourceIds(body);

    const report = await intelligenceService.analyze(id, user.id, {
      trigger: "MANUAL",
      sourceIds: sourceIds ?? undefined,
      signal: request.signal,
    });

    return Response.json({
      run: report.run,
      snapshot: report.snapshot,
      aiApplied: report.aiApplied,
      aiErrorCode: report.aiErrorCode,
      notes: report.notes,
    });
  } catch (error) {
    return wrapIntelligenceHttpError(error);
  }
}
