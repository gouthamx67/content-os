import {
  editorService,
} from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { editorErrorResponse } from "../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId } = await context.params;

    const detail = await editorService.getDocument({
      projectId: id,
      userId: user.id,
      documentId,
    });

    return Response.json(
      {
        document: {
          id: detail.document.id,
          projectId: detail.document.projectId,
          name: detail.document.name,
          status: detail.document.status,
          documentVersion: detail.document.documentVersion,
          currentRevisionId: detail.document.currentRevisionId,
          revisionNumber: detail.revision.revisionNumber,
          revisionCount: detail.document.revisionCount,
          lastOperation: detail.document.lastOperation,
          createdById: detail.document.createdById,
          createdAt: detail.document.createdAt,
          updatedAt: detail.document.updatedAt,
        },
        snapshot: detail.snapshot,
        revision: {
          id: detail.revision.id,
          revisionNumber: detail.revision.revisionNumber,
          operationType: detail.revision.operationType,
          sourceType: detail.revision.sourceType,
          sourceId: detail.revision.sourceId,
          createdAt: detail.revision.createdAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id, documentId } = await context.params;

    await editorService.archive({
      projectId: id,
      userId: user.id,
      documentId,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return editorErrorResponse(error);
  }
}