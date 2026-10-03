import { Readable } from "node:stream";
import {
  imageRepository,
  projectService,
} from "../../../../../../../../infrastructure/services";
import { imageStorage } from "../../../../../../../../modules/image-generation/storage/image-storage";
import { requireUser } from "../../../../../../../../lib/require-auth";
import { HttpError } from "../../../../../../../../lib/http";
import { imageErrorResponse } from "../../../../../../../../lib/image-http";

type RouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

/**
 * Streams the raster bytes of a generated asset.
 *
 * Authorization happens against the asset row first, so the storage key is only
 * dereferenced after the caller is proven to own the project. The key itself is
 * never sent to the client and is never taken from the request.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await requireUser(request);
    const { id, assetId } = await context.params;

    await projectService.getAuthorized(id, user.id);

    const asset = await imageRepository.getAsset(id, assetId);
    if (!asset) {
      throw new HttpError(404, "Generated image asset not found");
    }

    const extension = asset.outputFormat === "PNG" ? "png" : "jpg";
    const stream = imageStorage.read(asset.storageKey);
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.byteSize),
        "Content-Disposition": `inline; filename="${assetId}.${extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return imageErrorResponse(error);
  }
}
