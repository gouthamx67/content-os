import { writingGenerationService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import {
  writingDocumentDetailView,
  writingErrorResponse,
} from "../../../../../../../lib/writing-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

/** Reads one document with its variants and claims. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId } = await context.params;

    const view = await writingGenerationService.getDocument({
      projectId: id,
      documentId,
      userId: user.id,
    });

    return Response.json(writingDocumentDetailView(view));
  } catch (error) {
    return writingErrorResponse(error);
  }
}
