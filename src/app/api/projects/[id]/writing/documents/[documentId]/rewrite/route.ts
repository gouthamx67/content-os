import { writingGenerationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../../lib/http";
import {
  writingErrorResponse,
  writingVariantView,
} from "../../../../../../../../lib/writing-http";
import type { RewriteInstruction } from "../../../../../../../../modules/writing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

/**
 * Rewrites the selected variant.
 *
 * A rewrite never overwrites the previous text: it appends a new variant with
 * its own claims, so the history of what was written and why stays intact.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.aiGeneration,
      user.id,
    );
    if (limited) return limited;
    const { id, documentId } = await context.params;

    const body = (await parseJsonBody(request)) ?? {};

    const variant = await writingGenerationService.rewrite({
      projectId: id,
      documentId,
      instruction: body["instruction"] as RewriteInstruction,
      userId: user.id,
    });

    return Response.json({ variant: writingVariantView(variant) });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
