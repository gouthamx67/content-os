import {
  editorAIService,
} from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../../../lib/http";
import { editorErrorResponse } from "../../../../../../../../lib/editor-http";

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
    const instructions =
      typeof body["instructions"] === "string" ? body["instructions"] : "";
    if (!baseRevision) {
      throw new HttpError(400, "baseRevision is required");
    }
    if (!instructions) {
      throw new HttpError(400, "instructions is required");
    }

    const provider = body["provider"] === "REMOTE" ? "REMOTE" : "LOCAL";
    const nodeId =
      typeof body["nodeId"] === "string" ? body["nodeId"] : null;

    const proposal = await editorAIService.propose({
      projectId: id,
      userId: user.id,
      documentId,
      baseRevision,
      instructions,
      nodeId,
      provider,
    });

    return Response.json({
      proposal: {
        proposalId: proposal.proposalId,
        baseRevision: proposal.baseRevision,
        summary: proposal.summary,
        provider: proposal.provider,
        grounding: proposal.grounding,
        operation: proposal.operation,
      },
    });
  } catch (error) {
    return editorErrorResponse(error);
  }
}