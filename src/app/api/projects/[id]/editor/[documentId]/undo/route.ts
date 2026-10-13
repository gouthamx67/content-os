import {
  editorService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import { editorErrorResponse } from "../../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, documentId } = await context.params;

    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const baseRevision =
      typeof body["baseRevision"] === "string" ? body["baseRevision"] : "";

    const detail = await editorService.undo({
      projectId: id,
      userId: user.id,
      documentId,
      baseRevision,
    });

    return Response.json(
      {
        document: {
          id: detail.document.id,
          status: detail.document.status,
          currentRevisionId: detail.document.currentRevisionId,
          revisionCount: detail.document.revisionCount,
          lastOperation: detail.document.lastOperation,
        },
        revision: {
          id: detail.revision.id,
          revisionNumber: detail.revision.revisionNumber,
          restoredFromRevisionId: detail.revision.restoredFromRevisionId,
        },
        snapshot: detail.snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}