import { writingGenerationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import {
  writingErrorResponse,
  writingVariantView,
} from "../../../../../../../../lib/writing-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

/** Selects one variant as the document's canonical copy. */
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

    const variant = await writingGenerationService.selectVariant({
      projectId: id,
      documentId,
      variantId: typeof body["variantId"] === "string" ? body["variantId"] : "",
      userId: user.id,
    });

    return Response.json({ variant: writingVariantView(variant) });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
