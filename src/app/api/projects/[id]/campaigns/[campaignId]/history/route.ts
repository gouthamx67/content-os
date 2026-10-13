import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { campaignErrorResponse } from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, campaignId } = await context.params;

    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get("limit"));
    const offset = clampOffset(url.searchParams.get("offset"));

    const { total, revisions } = await campaignService.history(
      user.id,
      id,
      campaignId,
      limit,
      offset,
    );

    return Response.json(
      { revisions, total },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return campaignErrorResponse(error);
  }
}

function clampLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function clampOffset(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}
