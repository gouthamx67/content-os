import { HttpError } from "../../../lib/http";
import { normalizeAssetRef } from "../domain/validation";

export type ResolvedAssetRef = {
  kind: "capture" | "asset" | "generated";
  id: string;
  ref: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

/**
 * Turns a layer's `assetRef` into a verified resource.
 *
 * The reference is re-validated here even though the layer validator already
 * looked at it: a stored row is not proof of ownership, and this is the boundary
 * where a `capture:<takeId>` in project B must fail rather than resolve against
 * project A's bytes.
 */
export async function resolveAssetRef(
  projectId: string,
  rawRef: string,
): Promise<ResolvedAssetRef> {
  const ref = normalizeAssetRef(rawRef);
  const match = /^(capture|asset|generated):([A-Za-z0-9_-]+)$/.exec(ref);

  if (!match) {
    throw new HttpError(
      400,
      "assetRef must be a capture:, asset: or generated: reference",
    );
  }

  const kind = match[1] as "capture" | "asset" | "generated";
  const id = match[2]!;

  const { db } = await import("../../../prisma/db");

  if (kind === "generated") {
    const generated = await db.orm.public.GeneratedImageAsset.where({
      id,
      projectId,
    }).first();

    if (!generated || generated.deletedAt) {
      throw new HttpError(404, "Referenced generated image was not found");
    }

    return {
      kind,
      id,
      ref,
      width: generated.width,
      height: generated.height,
      durationMs: null,
    };
  }

  if (kind === "capture") {
    const take = await db.orm.public.CaptureTake.where({ id, projectId }).first();

    if (!take || take.status === "DELETED") {
      throw new HttpError(404, "Referenced capture take was not found");
    }

    return {
      kind,
      id,
      ref,
      width: take.width ?? null,
      height: take.height ?? null,
      durationMs: take.durationMs ?? null,
    };
  }

  const asset = await db.orm.public.Asset.where({ id, projectId }).first();

  if (!asset) {
    throw new HttpError(404, "Referenced asset was not found");
  }

  return {
    kind,
    id,
    ref,
    width: null,
    height: null,
    durationMs: null,
  };
}
