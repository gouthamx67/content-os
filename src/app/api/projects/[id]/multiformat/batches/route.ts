import { adaptationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import {
  adaptationBatchDetailView,
  adaptationBatchView,
  adaptationErrorResponse,
} from "../../../../../../lib/multiformat-http";
import type { AdaptationSourceType } from "../../../../../../modules/multiformat-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const SOURCE_TYPES: readonly string[] = [
  "WRITING_VARIANT",
  "GENERATED_IMAGE",
  "VISUAL_COMPOSITION",
];

/**
 * Lists this project's adaptation batches, newest first.
 *
 * Only the caller's own project is ever listed; a batch id from another project is
 * not reachable from this route at all.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.renderDispatch,
      user.id,
    );
    if (limited) return limited;
    const { id: projectId } = await context.params;

    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit =
      limitParam && Number.isFinite(Number(limitParam))
        ? Math.min(Math.max(Number(limitParam), 1), 50)
        : undefined;

    const batches = await adaptationService.listBatches({
      projectId,
      userId: user.id,
      limit,
    });

    return Response.json({ batches: batches.map(adaptationBatchView) });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}

/**
 * Creates an adaptation batch.
 *
 * The request carries only intent — which source, which formats, which platforms.
 * Every limit, every platform verdict and the frozen source itself are decided on
 * the server, so a client cannot ask for a shape the registry does not have, or a
 * platform CP09 does not recognise.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id: projectId } = await context.params;

    const body = (await parseJsonBody(request)) ?? {};

    const sourceType = body["sourceType"];
    const sourceId = body["sourceId"];

    if (
      typeof sourceType !== "string" ||
      !SOURCE_TYPES.includes(sourceType) ||
      typeof sourceId !== "string" ||
      sourceId.length === 0
    ) {
      throw new HttpError(400, "A sourceType and sourceId are required");
    }

    const targets = Array.isArray(body["targets"]) ? body["targets"] : [];

    const created = await adaptationService.createBatch({
      projectId,
      userId: user.id,
      sourceType: sourceType as AdaptationSourceType,
      sourceId,
      targets: targets.map((target) => {
        const entry = (target ?? {}) as Record<string, unknown>;

        return {
          formatId: typeof entry["formatId"] === "string" ? entry["formatId"] : "",
          platformId:
            typeof entry["platformId"] === "string" ? entry["platformId"] : null,
        };
      }),
    });

    return Response.json(adaptationBatchDetailView(created), { status: 201 });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
