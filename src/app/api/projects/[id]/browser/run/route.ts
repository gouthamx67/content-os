import { browserService, sourceService } from "../../../../../../infrastructure/services";
import { parseRunRequest, serializeSession, wrapBrowserHttpError } from "../../../../../../lib/browser-api";
import { HttpError, isSameOrigin, parseJsonBody } from "../../../../../../lib/http";
import { requireUser } from "../../../../../../lib/require-auth";

export const maxDuration = 300;

type RunRouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Starts one browser task. The target must be a source in this project, so a
 * caller cannot point the agent at an arbitrary host by inventing an id.
 *
 * The source also anchors the origin: the start URL is the source's own URI, or
 * a caller-supplied URL on that exact origin. Without this the request could
 * name a legitimate project source while sending the agent somewhere else, and
 * the recorded evidence would point at a host the project never declared.
 */
export async function POST(request: Request, context: RunRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const body = parseRunRequest((await parseJsonBody(request)) ?? {});

    // Authorizes the project and proves the target source belongs to it.
    const sources = await sourceService.list(id, user.id);
    const target = sources.find((source) => source.id === body.targetSourceId);
    if (!target) {
      throw new HttpError(404, "Target source was not found in this project");
    }
    if (!target.uri) {
      throw new HttpError(400, "Target source has no browsable URL");
    }
    const startUrl = resolveStartUrl(target.uri, body.url);

    const session = await browserService.runTask(
      {
        projectId: id,
        targetSourceId: body.targetSourceId,
        initialUrl: startUrl,
        goal: body.goal,
        successCriteria: body.successCriteria,
      },
      user.id,
    );

    return Response.json({ session: serializeSession(session) }, { status: 201 });
  } catch (error) {
    return wrapBrowserHttpError(error);
  }
}

function resolveStartUrl(sourceUri: string, requested: string | null): string {
  if (!requested) return sourceUri;
  const source = new URL(sourceUri);
  const target = new URL(requested);
  if (source.origin !== target.origin) {
    throw new HttpError(400, "Start URL must be on the target source origin");
  }
  return target.toString();
}
