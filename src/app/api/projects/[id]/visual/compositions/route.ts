import { visualCompositionService } from "../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../lib/require-auth";
import { HttpError, isSameOrigin } from "../../../../../../lib/http";
import { visualErrorResponse as visualError } from "../../../../../../lib/visual-http";
import {
  optionalCount,
  optionalString,
  readJsonObject,
} from "../../../../../../lib/visual-api";
import { buildSceneGraph } from "../../../../../../modules/visual-motion-engine/serialization/scene-graph";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const compositions = await visualCompositionService.listCompositions({
      projectId: id,
      userId: user.id,
    });

    return Response.json({
      compositions: compositions.map(buildSceneGraph),
    });
  } catch (error) {
    return visualError(error);
  }
}

/**
 * Creates a composition for a project.
 *
 * The caller may name a shot and nothing else: dimensions, frame rate and
 * duration all have defaults, and where a shot is named its own duration seeds
 * the composition so the preview starts the same length as the scene it serves.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = await readJsonObject(request);

    const composition = await visualCompositionService.createComposition({
      projectId: id,
      userId: user.id,
      name: optionalString(body, "name"),
      shotId: optionalString(body, "shotId"),
      width: optionalCount(body, "width"),
      height: optionalCount(body, "height"),
      frameRate: optionalCount(body, "frameRate"),
      durationMs: optionalCount(body, "durationMs"),
    });

    return Response.json(
      { composition: buildSceneGraph(composition) },
      { status: 201 },
    );
  } catch (error) {
    return visualError(error);
  }
}
