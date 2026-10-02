import { captureService } from "../../../../../../../../infrastructure/services";
import { HttpError, isSameOrigin } from "../../../../../../../../lib/http";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { MAX_CAPTURE_BYTES } from "../../../../../../../../modules/capture-engine/capture-validation";
import { isCaptureMode } from "../../../../../../../../modules/capture-engine/capture-types";
import { captureErrorResponse as captureError } from "../../../../../../../../lib/capture-http";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

/**
 * Persists one real take.
 *
 * The multipart body is read to a Buffer and handed to the storage layer, which
 * computes the checksum from those exact bytes. Nothing about the capture is
 * taken on trust: the mode must be one the engine supports, and the session must
 * be ACTIVE, so a take cannot land in a draft or completed session by posting
 * to this URL.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const { id, sessionId } = await context.params;

    const declaredLength = Number(request.headers.get("content-length") ?? "");

    if (Number.isFinite(declaredLength) && declaredLength > MAX_CAPTURE_BYTES) {
      // Checked before the body is read: buffering 300 MB into memory to then
      // reject it is how a handful of requests take the process down.
      throw new HttpError(413, "Capture exceeds the 250 MB limit");
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new HttpError(400, "file is required");
    }

    const mode = form.get("mode");

    if (!isCaptureMode(mode)) {
      throw new HttpError(400, "Invalid capture mode");
    }

    const shotIdValue = form.get("shotId");
    const shotId =
      typeof shotIdValue === "string" && shotIdValue.length > 0
        ? shotIdValue
        : null;

    const retakeOf = form.get("retakeOf");
    const previousTakeId =
      typeof retakeOf === "string" && retakeOf.length > 0 ? retakeOf : null;

    const metadataRaw = form.get("metadata");
    let metadata: unknown;

    if (typeof metadataRaw === "string" && metadataRaw.length > 0) {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        throw new HttpError(400, "metadata must be valid JSON");
      }
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const take = previousTakeId
      ? await captureService.retake({
          projectId: id,
          sessionId,
          userId: user.id,
          previousTakeId,
          mode,
          shotId,
          filename: file.name,
          mimeType: file.type,
          bytes,
          metadata,
        })
      : await captureService.addTake({
          projectId: id,
          sessionId,
          userId: user.id,
          shotId,
          mode,
          filename: file.name,
          mimeType: file.type,
          bytes,
          metadata,
        });

    return Response.json(
      {
        take: {
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
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return captureError(error);
  }
}
