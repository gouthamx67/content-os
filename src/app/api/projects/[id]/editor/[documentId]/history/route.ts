import {
  editorService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { editorErrorResponse } from "../../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId } = await context.params;

    const { document, revisions, total } = await editorService.history({
      projectId: id,
      userId: user.id,
      documentId,
    });

    return Response.json(
      {
        document: {
          id: document.id,
          currentRevisionId: document.currentRevisionId,
          status: document.status,
          revisionCount: document.revisionCount,
        },
        revisions: revisions.map((revision) => ({
          id: revision.id,
          documentId: revision.documentId,
          revisionNumber: revision.revisionNumber,
          operationType: revision.operationType,
          sourceType: revision.sourceType,
          sourceId: revision.sourceId,
          provenanceSourceIds: revision.provenanceSourceIds,
          restoredFromRevisionId: revision.restoredFromRevisionId,
          createdById: revision.createdById,
          createdAt: revision.createdAt,
        })),
        total,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}