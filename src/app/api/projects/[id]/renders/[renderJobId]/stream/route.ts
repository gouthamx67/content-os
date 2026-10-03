import { Readable } from "node:stream";
import { renderJobService } from "../../../../../../../infrastructure/services";
import { renderStorage } from "../../../../../../../modules/video-rendering/storage/render-storage";
import { requireUser } from "../../../../../../../lib/require-auth";
import { renderErrorResponse as renderError } from "../../../../../../../lib/render-http";

type RouteContext = {
  params: Promise<{ id: string; renderJobId: string }>;
};

/**
 * Streams the rendered artifact.
 *
 * Authorization happens against the job and artifact rows first, so the storage
 * key is only ever dereferenced after the caller has been proven to own the
 * project. The key itself is never sent to the client.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, renderJobId } = await context.params;

    const artifact = await renderJobService.artifact({
      projectId: id,
      renderJobId,
      userId: user.id,
    });

    if (!artifact) {
      return Response.json({ error: "Render artifact not ready" }, { status: 404 });
    }

    const stream = renderStorage.read(artifact.storageKey);
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Length": String(artifact.byteSize),
        "Content-Disposition": `attachment; filename="${renderJobId}.mp4"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return renderError(error);
  }
}
