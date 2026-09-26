import { intelligenceService } from "../../../../../infrastructure/services";
import {
  serializeGraph,
  wrapIntelligenceHttpError,
} from "../../../../../lib/intelligence-api";
import { requireUser } from "../../../../../lib/require-auth";

export const maxDuration = 30;

type IntelligenceRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: IntelligenceRouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const [summary, graph, runs, snapshots] = await Promise.all([
      intelligenceService.getSummary(id, user.id),
      intelligenceService.getGraph(id, user.id),
      intelligenceService.listRuns(id, user.id, 10),
      intelligenceService.listSnapshots(id, user.id, 10),
    ]);
    return Response.json({ summary, graph: serializeGraph(graph), runs, snapshots });
  } catch (error) {
    return wrapIntelligenceHttpError(error);
  }
}
