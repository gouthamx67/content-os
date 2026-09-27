import { brandService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  parseBrandForce,
  parseBrandSourceIds,
  serializeBrandProfile,
  wrapBrandHttpError,
} from "../../../../../../lib/brand-api";
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
    const sourceIds = parseBrandSourceIds(body);

    // A manual analysis re-reads whatever the caller named, and otherwise only
    // new or changed sources. Pass force to ignore change detection.
    const report = await brandService.analyze(id, user.id, {
      trigger: "MANUAL",
      sourceIds,
      force: parseBrandForce(body),
      signal: request.signal,
    });

    return Response.json({
      brand: serializeBrandProfile(report.profile),
      execution: report.execution,
      aiApplied: report.aiApplied,
      aiErrorCode: report.aiErrorCode,
      analyzedSourceIds: report.analyzedSourceIds,
      skipped: report.skipped,
      notes: report.notes,
    });
  } catch (error) {
    return wrapBrandHttpError(error);
  }
}
