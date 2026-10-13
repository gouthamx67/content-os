import {
  editorImportService,
} from "../../../../../../infrastructure/services";
import type { CreatedEditorDocument } from "../../../../../../modules/editor-engine/integrations/imports";
import { requireUser } from "../../../../../../lib/require-auth";
import {
  HttpError,
  isSameOrigin,
  parseJsonBody,
} from "../../../../../../lib/http";
import { editorErrorResponse } from "../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const IMPORT_KINDS = [
  "COMPOSITION",
  "AUDIO_COMPOSITION",
  "MULTIMODAL",
  "GENERATED_IMAGE",
  "WRITING_VARIANT",
  "ADAPTATION",
] as const;

type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * The import surface is one route, because every adapter turns an artifact the
 * project already owns into the same first revision: same service, same CAS,
 * same provenance. The route only decides which adapter to run.
 */
function isImportKind(value: unknown): value is ImportKind {
  return (
    typeof value === "string" &&
    (IMPORT_KINDS as readonly string[]).includes(value)
  );
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `${key} is required`);
  }
  return value;
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

    const kind = body["kind"];
    if (!isImportKind(kind)) {
      throw new HttpError(400, `kind must be one of ${IMPORT_KINDS.join(", ")}`);
    }

    const name =
      typeof body["name"] === "string" && body["name"].length > 0
        ? body["name"]
        : undefined;

    let detail: CreatedEditorDocument;

    if (kind === "WRITING_VARIANT") {
      detail = await editorImportService.importFromCP18({
        projectId: id,
        userId: user.id,
        name,
        documentId: requiredString(body, "documentId"),
        variantId: requiredString(body, "variantId"),
      });
    } else {
      const sourceId = requiredString(body, "sourceId");
      if (kind === "COMPOSITION") {
        detail = await editorImportService.importFromCP14({
          projectId: id,
          userId: user.id,
          name,
          compositionId: sourceId,
        });
      } else if (kind === "AUDIO_COMPOSITION") {
        detail = await editorImportService.importFromCP16({
          projectId: id,
          userId: user.id,
          name,
          audioCompositionId: sourceId,
        });
      } else if (kind === "MULTIMODAL") {
        detail = await editorImportService.importComposition({
          projectId: id,
          userId: user.id,
          name,
          compositionId: sourceId,
        });
      } else if (kind === "GENERATED_IMAGE") {
        detail = await editorImportService.importFromCP17({
          projectId: id,
          userId: user.id,
          name,
          assetId: sourceId,
        });
      } else {
        detail = await editorImportService.importFromCP19({
          projectId: id,
          userId: user.id,
          name,
          jobId: sourceId,
        });
      }
    }

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