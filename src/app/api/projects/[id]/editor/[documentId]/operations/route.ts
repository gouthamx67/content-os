import {
  editorService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../lib/http";
import {
  editorErrorResponse,
  parseEditorOperation,
} from "../../../../../../../lib/editor-http";

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
    if (!baseRevision) {
      throw new HttpError(400, "baseRevision is required");
    }

    const operation = parseEditorOperation(body["operation"]);

    const detail = await editorService.applyOperation({
      projectId: id,
      userId: user.id,
      documentId,
      baseRevision,
      operation,
    });

    return Response.json(
      {
        revision: {
          id: detail.revision.id,
          revisionNumber: detail.revision.revisionNumber,
          operationType: detail.revision.operationType,
          sourceType: detail.revision.sourceType,
          sourceId: detail.revision.sourceId,
          restoredFromRevisionId: detail.revision.restoredFromRevisionId,
          createdAt: detail.revision.createdAt,
        },
        document: {
          id: detail.document.id,
          status: detail.document.status,
          currentRevisionId: detail.document.currentRevisionId,
          revisionCount: detail.document.revisionCount,
          updatedAt: detail.document.updatedAt,
        },
        snapshot: detail.snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}