import { Readable } from "node:stream";
import { adaptationService } from "../../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { adaptationErrorResponse } from "../../../../../../../../lib/multiformat-http";
import { adaptationStorage } from "../../../../../../../../modules/multiformat-engine/storage/adaptation-storage";
import { renderStorage } from "../../../../../../../../modules/video-rendering/storage/render-storage";

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>;
};

/**
 * Streams a finished image or video variant.
 *
 * Authorization happens against the job row first, so a storage key is only ever
 * dereferenced after the caller has been proven to own the project. The key itself
 * never leaves the server: the client gets bytes, not the path to them.
 *
 * A video's bytes belong to CP15's render storage and are not copied — CP19 points
 * at the render that produced them, so a variant and its render can never disagree
 * about what was encoded.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id: projectId, jobId } = await context.params;

    const artifact = await adaptationService.artifactFor({
      projectId,
      jobId,
      userId: user.id,
    });

    const storage = artifact.storage === "CP15" ? renderStorage : adaptationStorage;
    const extension = artifact.mimeType.includes("mp4") ? "mp4" : "png";
    const body = Readable.toWeb(
      storage.read(artifact.storageKey),
    ) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Length": String(artifact.byteSize),
        "Content-Disposition": `attachment; filename="${jobId}.${extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return adaptationErrorResponse(error);
  }
}
