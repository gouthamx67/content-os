import {
  editorService,
} from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../lib/http";
import { editorErrorResponse } from "../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const documents = await editorService.listDocuments({
      projectId: id,
      userId: user.id,
    });

    return Response.json({ documents });
  } catch (error) {
    return editorErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin request");
    }

    const { id } = await context.params;

    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "Expected a JSON body");
    }

    const name = typeof body["name"] === "string" ? body["name"] : "Untitled edit";

    const detail = await editorService.createDocument({
      projectId: id,
      userId: user.id,
      name,
    });

    return Response.json(
      {
        document: {
          id: detail.document.id,
          name: detail.document.name,
          status: detail.document.status,
          revisionNumber: detail.revision.revisionNumber,
          revisionId: detail.revision.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return editorErrorResponse(error);
  }
}