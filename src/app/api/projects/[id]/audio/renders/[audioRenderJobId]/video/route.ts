import { Readable } from "node:stream";
import { audioRenderJobService } from "../../../../../../../../infrastructure/services";
import { audioStorage } from "../../../../../../../../modules/audio-engine/storage/audio-storage";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { audioErrorResponse } from "../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; audioRenderJobId: string }>;
};

/**
 * Streams the final muxed MP4.
 *
 * The CP15 video master is copied, never rewritten, so this artifact is the
 * only download that carries both the picture and the mix. A job with no muxed
 * artifact (a WAV-only render, or one still finishing) reads as not found.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, audioRenderJobId } = await context.params;

    const artifact = await audioRenderJobService.muxedArtifact({
      projectId: id,
      audioRenderJobId,
      userId: user.id,
    });

    if (!artifact) {
      return Response.json(
        { error: "Muxed video artifact not ready" },
        { status: 404 },
      );
    }

    const stream = audioStorage.read(artifact.storageKey);
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Length": String(artifact.byteSize),
        "Content-Disposition": `attachment; filename="${audioRenderJobId}.mp4"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
