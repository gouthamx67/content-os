import { writingGenerationService } from "../../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../../lib/require-auth";
import {
  writingClaimView,
  writingErrorResponse,
} from "../../../../../../../../../lib/writing-http";

type RouteContext = {
  params: Promise<{ id: string; documentId: string; claimId: string }>;
};

/** Reads one claim with the source ids that support it. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, documentId, claimId } = await context.params;

    const claim = await writingGenerationService.getClaim({
      projectId: id,
      documentId,
      claimId,
      userId: user.id,
    });

    return Response.json({ writingClaim: writingClaimView(claim) });
  } catch (error) {
    return writingErrorResponse(error);
  }
}
