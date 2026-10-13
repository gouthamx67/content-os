import {
  editorService,
} from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { editorErrorResponse } from "../../../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string; revisionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId, revisionId } = await context.params;

    const { revision, snapshot } = await editorService.previewRevision({
      projectId: id,
      userId: user.id,
      documentId,
      revisionId,
    });

    return Response.json(
      {
        revision: {
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          operationType: revision.operationType,
          sourceType: revision.sourceType,
          sourceId: revision.sourceId,
          createdAt: revision.createdAt,
        },
        snapshot,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}