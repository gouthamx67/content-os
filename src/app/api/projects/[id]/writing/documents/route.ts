import { writingGenerationService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  writingDocumentView,
  writingErrorResponse,
} from "../../../../../../lib/writing-http";
import type { WritingBlockType } from "../../../../../../modules/writing-engine/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Lists the project's writing documents, newest first. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const blockType = new URL(request.url).searchParams.get("blockType");

    const documents = await writingGenerationService.listDocuments({
      projectId: id,
      userId: user.id,
      blockType: blockType ? (blockType as WritingBlockType) : undefined,
    });

    return Response.json({
      writingDocuments: documents.map(writingDocumentView),
    });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
