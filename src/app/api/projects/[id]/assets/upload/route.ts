import { randomUUID } from "node:crypto";
import {
  assetService,
  projectService,
  storage,
} from "../../../../../../infrastructure/services";
import {
  HttpError,
  isSameOrigin,
  wrapHttpError,
} from "../../../../../../lib/http";
import { requireUser } from "../../../../../../lib/require-auth";
import { enforceRateLimit, RATE_LIMITS } from "../../../../../../lib/rate-limit";
import { isAssetType } from "../../../../../../lib/enums";
import {
  MAX_ASSET_UPLOAD_BYTES,
  assetExtensionForMime,
  assetUploadName,
  imageBytesMatchMime,
  isAllowedAssetUpload,
  isImageAssetType,
} from "../../../../../../lib/asset-upload";

export const runtime = "nodejs";

type UploadRouteContext = {
  params: Promise<{ id: string }>;
};

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Stores a real file as a project asset. The browser form and this route agree
 * on the contract: one `file`, the asset `type`, and an optional display
 * `name`. Bytes land in project-owned storage, which is what the image and
 * editor resolvers read later, so an uploaded screenshot can actually be used
 * as product UI instead of only being a URL.
 */
export async function POST(request: Request, context: UploadRouteContext) {
  try {
    if (!isSameOrigin(request)) {
      throw new HttpError(403, "Cross-origin requests are not allowed");
    }

    const { user } = await requireUser(request);
    const limited = await enforceRateLimit(
      RATE_LIMITS.sourceIngestion,
      user.id,
    );
    if (limited) return limited;

    const { id } = await context.params;

    // Authorize before reading the body: an unauthorized caller should not be
    // able to make the server buffer or write bytes at all.
    await projectService.getAuthorized(id, user.id);

    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_ASSET_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES
    ) {
      throw new HttpError(413, "File exceeds the 10 MB limit");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "file is required");
    }

    const type = form.get("type");
    if (!isAssetType(type)) {
      throw new HttpError(400, "A valid asset type is required");
    }

    const mimeType = (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!isAllowedAssetUpload(type, mimeType)) {
      throw new HttpError(415, "That file type is not supported for this asset");
    }

    if (file.size <= 0) {
      throw new HttpError(400, "File is empty");
    }
    if (file.size > MAX_ASSET_UPLOAD_BYTES) {
      throw new HttpError(413, "File exceeds the 10 MB limit");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (isImageAssetType(type) && !imageBytesMatchMime(mimeType, bytes)) {
      throw new HttpError(415, "The file contents do not match its image type");
    }

    const extension = assetExtensionForMime(mimeType);
    if (!extension) {
      throw new HttpError(415, "That file type is not supported");
    }

    const requestedName = form.get("name");
    const displayName = assetUploadName(
      typeof requestedName === "string" ? requestedName : "",
      file.name,
      extension,
    );

    const safeProjectId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const key = `projects/${safeProjectId}/assets/${randomUUID()}.${extension}`;
    const stored = await storage.put(key, bytes, mimeType);

    try {
      const asset = await assetService.create(
        id,
        {
          type,
          name: displayName,
          uri: stored.uri,
          metadata: JSON.stringify({
            mimeType,
            sizeBytes: bytes.byteLength,
            originalName: file.name,
          }),
        },
        user.id,
      );

      return Response.json({ asset }, { status: 201 });
    } catch (error) {
      await storage.delete(key).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return wrapHttpError(error);
  }
}
