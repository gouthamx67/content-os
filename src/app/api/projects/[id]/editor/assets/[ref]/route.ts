import { Readable } from "node:stream";
import {
  editorAssetResolver,
  projectService,
} from "../../../../../../../infrastructure/services";
import { requireUser } from "../../../../../../../lib/require-auth";
import { editorErrorResponse } from "../../../../../../../lib/editor-http";

type RouteContext = {
  params: Promise<{ id: string; ref: string }>;
};

/**
 * Streams an editor media ref as `prefix:id`.
 *
 * The caller has to be a project member (same gate every other media route
 * applies), and the ref is then expanded by the resolver, which verifies
 * against the owning engine that the artifact exists and belongs to the
 * requested project before storage is ever reached. On a copy-then-edit node
 * the ref folds back to its source artifact, so a copy always streams exactly
 * like the engine that produced it would.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, ref } = await context.params;

    await projectService.getAuthorized(id, user.id);

    const resolved = await editorAssetResolver.resolve(id, ref);

    const stream = resolved.read();
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": resolved.mimeType,
        "Content-Length": String(resolved.byteSize),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return editorErrorResponse(error);
  }
}