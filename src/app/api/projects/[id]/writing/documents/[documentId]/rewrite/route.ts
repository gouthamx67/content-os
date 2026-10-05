import { writingGenerationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
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
    const { id, documentId } = await context.params;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

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
