import { Readable } from "node:stream";
import {
  audioSourceResolver,
  projectService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { HttpError } from "../../../../../../../lib/http";
import { audioErrorResponse } from "../../../../../../../lib/audio-http";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Streams a track's source bytes for in-browser preview.
 *
 * The source is resolved against the *project*, so a `capture:` or `asset:`
 * reference naming another project's media resolves to nothing. Only a logical
 * reference is echoed back; a storage key or filesystem path is never part of
 * the response.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;

    const sourceRef = new URL(request.url).searchParams.get("sourceRef");
    if (!sourceRef) {
      throw new HttpError(400, "A sourceRef query parameter is required");
    }

    await projectService.getAuthorized(id, user.id);

    const resolved = await audioSourceResolver.resolve(id, sourceRef);
    const body = Readable.toWeb(
      resolved.open(),
    ) as unknown as ReadableStream<Uint8Array>;

    const headers: Record<string, string> = {
      "Content-Type": resolved.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };

    if (resolved.byteSize !== null) {
      headers["Content-Length"] = String(resolved.byteSize);
    }

    if (resolved.originalName) {
      const safeName = resolved.originalName.replace(/["\\]/g, "_");
      headers["Content-Disposition"] = `inline; filename="${safeName}"`;
    }

    return new Response(body, { status: 200, headers });
  } catch (error) {
    return audioErrorResponse(error);
  }
}
