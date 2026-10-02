import { Readable } from "node:stream";
import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { captureErrorResponse } from "../../../../../../../../lib/capture-http";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; takeId: string }>;
};

/**
 * Streams a take's bytes.
 *
 * The storage key is resolved from the take row, never taken from the query
 * string: a request that could name a key could read any file the process can
 * reach, including another project's captures and anything else on disk. A
 * `storageKey` parameter is ignored rather than honoured, so probing for the
 * parameter does not even produce a different error.
 *
 * The take is scoped to the route's project and the caller is a member of that
 * project, so project B asking for a project A take gets a 404 rather than a
 * 403 — a 403 would confirm the take id is real.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, takeId } = await context.params;

    const { take, stream } = await captureService.resolveStream({
      projectId: id,
      takeId,
      userId: user.id,
    });

    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": take.mimeType,
        "Content-Length": String(take.byteSize),
        // Private and uncached: a capture is project data, and a shared cache
        // holding it would serve one member's footage to the next.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${sanitizeFilename(take.originalName ?? "capture")}"`,
        ETag: `"${take.checksumSha256}"`,
      },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return new Response("Not found", { status: 404 });
    }

    if (
      error instanceof Error &&
      (error.name === "CaptureError" || error.name === "HttpError")
    ) {
      return captureErrorResponse(error);
    }

    return new Response("Request failed", { status: 500 });
  }
}

/**
 * A filename from the client goes into a Content-Disposition header, so quotes
 * and newlines are stripped rather than escaped: an injected `"` or CRLF there
 * would let the value break out of the header the browser parses.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "capture";
}
