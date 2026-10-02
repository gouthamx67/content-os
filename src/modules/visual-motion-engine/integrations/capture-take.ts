import { HttpError } from "../../../lib/http";
import { normalizeAssetRef } from "../domain/validation";

export type ResolvedAssetRef = {
  kind: "capture" | "asset";
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
  const match = /^(capture|asset):([A-Za-z0-9_-]+)$/.exec(ref);

  if (!match) {
    throw new HttpError(400, "assetRef must be a capture: or asset: reference");
  }

  const kind = match[1] as "capture" | "asset";
  const id = match[2]!;

  const { db } = await import("../../../prisma/db");

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
