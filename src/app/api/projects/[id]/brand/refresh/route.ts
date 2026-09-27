import { brandService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import {
  serializeBrandProfile,
  wrapBrandHttpError,
} from "../../../../../../lib/brand-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 300;

type RefreshRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Re-reads only sources whose content changed since the last analysis. An
 * unchanged project returns the stored profile with `skipped: UP_TO_DATE`, so
 * a refresh is safe to call on a timer.
 */
export async function POST(request: Request, context: RefreshRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const report = await brandService.refresh(id, user.id);

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
