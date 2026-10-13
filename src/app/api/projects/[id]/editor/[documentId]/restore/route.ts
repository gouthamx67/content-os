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
    const revisionId =
      typeof body["revisionId"] === "string" ? body["revisionId"] : "";
    if (!revisionId) {
      throw new HttpError(400, "revisionId is required");
    }

    const detail = await editorService.restoreRevision({
      projectId: id,
      userId: user.id,
      documentId,
      baseRevision,
      revisionId,
    });

    return Response.json(
      {
        revision: {
          id: detail.revision.id,
          revisionNumber: detail.revision.revisionNumber,
          restoredFromRevisionId: detail.revision.restoredFromRevisionId,
        },
        document: {
          id: detail.document.id,
          currentRevisionId: detail.document.currentRevisionId,
          revisionCount: detail.document.revisionCount,
          lastOperation: detail.document.lastOperation,
        },
        snapshot: detail.snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}