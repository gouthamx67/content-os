import { intelligenceService } from "../../../../../../infrastructure/services";
import { isSameOrigin } from "../../../../../../lib/http";
import { wrapIntelligenceHttpError } from "../../../../../../lib/intelligence-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 300;

type RefreshRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Re-reads only the sources that are new or changed since the last run. When
 * nothing changed the previous run is returned unchanged.
 */
export async function POST(request: Request, context: RefreshRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const report = await intelligenceService.refresh(id, user.id);

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
