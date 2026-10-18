import { writingGenerationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../../../lib/rate-limit";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../../lib/http";
import {
  writingErrorResponse,
  writingVariantView,
} from "../../../../../../../../lib/writing-http";
import type { WritingProvider } from "../../../../../../../../modules/writing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

/**
 * Generates more variants for an existing document.
 *
 * Generation reuses the document's frozen context snapshot rather than reading
 * live project state, so new variants are grounded against the same facts the
 * document was created from.
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

    const variants = await writingGenerationService.generateVariants({
      projectId: id,
      documentId,
      userId: user.id,
      provider:
        typeof body["provider"] === "string"
          ? (body["provider"] as WritingProvider)
          : undefined,
      variantCount:
        typeof body["variantCount"] === "number"
          ? body["variantCount"]
          : undefined,
    });

    return Response.json(
      { variants: variants.map(writingVariantView) },
      { status: 201 },
    );
  } catch (error) {
    return writingErrorResponse(error);
  }
}
