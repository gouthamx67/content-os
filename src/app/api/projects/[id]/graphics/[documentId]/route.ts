import { graphicDocumentService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import {
  graphicDocumentView,
  imageErrorResponse,
} from "../../../../../../lib/image-http";
import type { ImageOutputFormat } from "../../../../../../modules/image-generation/domain/types";

type RouteContext = {
  params: Promise<{ id: string; documentId: string }>;
};

/** Reads a saved design, including its editable graph. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId } = await context.params;

    const document = await graphicDocumentService.get({
      projectId: id,
      documentId,
      userId: user.id,
    });

    return Response.json({ graphicDocument: graphicDocumentView(document) });
  } catch (error) {
    return imageErrorResponse(error);
  }
}

/**
 * Renames a design or resizes its canvas.
 *
 * A geometry change rebuilds the graph from the existing one, so text and
 * artwork survive a resize; a pure rename leaves the graph untouched.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

    const document = await graphicDocumentService.update({
      projectId: id,
      documentId,
      userId: user.id,
      name: typeof body["name"] === "string" ? body["name"] : undefined,
      width: typeof body["width"] === "number" ? body["width"] : undefined,
      height: typeof body["height"] === "number" ? body["height"] : undefined,
      outputFormat:
        typeof body["outputFormat"] === "string"
          ? (body["outputFormat"] as ImageOutputFormat)
          : undefined,
      transparent:
        typeof body["transparent"] === "boolean"
          ? body["transparent"]
          : undefined,
    });

    return Response.json({ graphicDocument: graphicDocumentView(document) });
  } catch (error) {
    return imageErrorResponse(error);
  }
}

/** Soft-deletes a saved design. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, documentId } = await context.params;

    await graphicDocumentService.remove({
      projectId: id,
      documentId,
      userId: user.id,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
