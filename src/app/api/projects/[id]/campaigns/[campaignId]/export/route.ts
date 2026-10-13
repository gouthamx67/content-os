import { campaignService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { campaignErrorResponse } from "../../../../../../../lib/campaign-http";

type RouteContext = {
  params: Promise<{ id: string; campaignId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, campaignId } = await context.params;

    const document = await campaignService.exportLaunchKit(user.id, id, campaignId);

    return new Response(`${JSON.stringify(document, null, 2)}\n`, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="campaign-${campaignId}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return campaignErrorResponse(error);
  }
}
