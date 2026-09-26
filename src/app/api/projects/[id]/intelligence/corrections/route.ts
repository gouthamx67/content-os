import { intelligenceService } from "../../../../../../infrastructure/services";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import { parseCorrectionRequest, wrapIntelligenceHttpError } from "../../../../../../lib/intelligence-api";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 60;

type CorrectionsRouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: CorrectionsRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body) {
      throw new HttpError(400, "A JSON body is required");
    }

    const correction = parseCorrectionRequest(body);
    const projectId = id;
    const userId = user.id;
    const service = intelligenceService;

    switch (correction.scope) {
      case "product": {
        const product = await service.correctProduct(projectId, userId, correction.changes);
        return Response.json({ product });
      }
      case "FEATURE":
        return Response.json({
          entity: await service.correctFeature(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "PROBLEM":
        return Response.json({
          entity: await service.correctProblem(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "BENEFIT":
        return Response.json({
          entity: await service.correctBenefit(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "CLAIM":
        return Response.json({
          entity: await service.correctClaim(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "WORKFLOW":
        return Response.json({
          entity: await service.correctWorkflow(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "AUDIENCE_SIGNAL":
        return Response.json({
          entity: await service.correctAudienceSignal(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "BRAND_SIGNAL":
        return Response.json({
          entity: await service.correctBrandSignal(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
      case "ASSET":
        return Response.json({
          entity: await service.correctAsset(
            projectId,
            userId,
            correction.canonicalKey,
            correction.changes,
          ),
        });
    }
  } catch (error) {
    return wrapIntelligenceHttpError(error);
  }
}
