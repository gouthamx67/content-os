import { graphicDocumentService } from "../../../../../infrastructure/services";
import { requireUser } from "../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../lib/http";
import {
  graphicDocumentView,
  imageErrorResponse,
} from "../../../../../lib/image-http";
import type {
  GraphicTemplateType,
  ImageOutputFormat,
} from "../../../../../modules/image-generation/domain/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Saves an editable design.
 *
 * The service builds the template's graph once and stores it with its digest, so
 * the document can be re-rendered later without the template being consulted
 * again.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const document = await graphicDocumentService.create({
      projectId: id,
      userId: user.id,
      name:
        typeof body["name"] === "string" && body["name"].trim().length > 0
          ? body["name"]
          : "Untitled graphic",
      templateType: body["templateType"] as GraphicTemplateType,
      prompt: typeof body["prompt"] === "string" ? body["prompt"] : "",
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
      intentId: typeof body["intentId"] === "string" ? body["intentId"] : null,
      directionId:
        typeof body["directionId"] === "string" ? body["directionId"] : null,
      storyboardId:
        typeof body["storyboardId"] === "string"
          ? body["storyboardId"]
          : null,
      sceneId: typeof body["sceneId"] === "string" ? body["sceneId"] : null,
    });

    return Response.json(
      { graphicDocument: graphicDocumentView(document) },
      { status: 201 },
    );
  } catch (error) {
    return imageErrorResponse(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const documents = await graphicDocumentService.list({
      projectId: id,
      userId: user.id,
    });

    return Response.json({
      graphicDocuments: documents.map(graphicDocumentView),
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
