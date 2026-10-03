import { Readable } from "node:stream";
import { audioRenderJobService } from "../../../../../../../../infrastructure/services";
import { audioStorage } from "../../../../../../../../modules/audio-engine/storage/audio-storage";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { audioErrorResponse } from "../../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string; audioRenderJobId: string }>;
};

/**
 * Streams the rendered WAV.
 *
 * Authorization happens against the job and artifact rows first, so the storage
 * key is only dereferenced after the caller is proven to own the project. The
 * key itself is never sent to the client.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, audioRenderJobId } = await context.params;

    const artifact = await audioRenderJobService.audioArtifact({
      projectId: id,
      audioRenderJobId,
      userId: user.id,
    });

    if (!artifact) {
      return Response.json(
        { error: "Audio artifact not ready" },
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
        "Content-Disposition": `attachment; filename="${audioRenderJobId}.wav"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
