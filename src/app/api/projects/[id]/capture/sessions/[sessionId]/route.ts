import { captureService } from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { buildCaptureManifest } from "../../../../../../../modules/capture-engine/capture-manifest";
import { modesForPlanItem } from "../../../../../../../modules/capture-engine/capture-plan";
import { captureErrorResponse as captureError } from "../../../../../../../lib/capture-http";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Everything the capture workspace needs for one session, read fresh from
 * PostgreSQL.
 *
 * The response is built from persisted rows on every request, so a refresh is a
 * real re-read rather than a replay of client state: that is the only way the
 * panel can claim a take survived. `storageKey` is deliberately absent — it is a
 * server-side path, and playback goes through the membership-checked stream
 * endpoint instead.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const session = await captureService.getSession({
      projectId: id,
      sessionId,
      userId: user.id,
    });

    const takes = await captureService.listTakes({
      projectId: id,
      sessionId,
      userId: user.id,
    });

    const plan = await captureService.capturePlan(id, session);

    return Response.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        storyboardId: session.storyboardId,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      },
      takes: takes.map((take) => ({
        id: take.id,
        shotId: take.shotId,
        mode: take.mode,
        status: take.status,
        mimeType: take.mimeType,
        byteSize: take.byteSize,
        checksumSha256: take.checksumSha256,
        width: take.width,
        height: take.height,
        durationMs: take.durationMs,
        frameRate: take.frameRate,
        metadata: take.metadata,
        createdAt: take.createdAt,
        acceptedAt: take.acceptedAt,
        rejectedAt: take.rejectedAt,
        deletedAt: take.deletedAt,
      })),
      capturePlan: plan.map((item) => ({
        ...item,
        availableModes: modesForPlanItem(item),
      })),
      manifest: buildCaptureManifest({
        sessionId: session.id,
        projectId: session.projectId,
        takes,
      }),
    });
  } catch (error) {
    return captureError(error);
  }
}

