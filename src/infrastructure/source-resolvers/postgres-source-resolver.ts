import type { ImageGenerationRepository } from "../../core/ports/image-generation-repository";
import type { VisualRepository } from "../../core/ports/visual-repository";
import type { WritingRepository } from "../../core/ports/writing-repository";
import { imageStorage } from "../../modules/image-generation/storage/image-storage";
import {
  hasTransparentPixels,
  inspectImage,
} from "../../modules/image-generation/artifact/image-metadata";
import type { AdaptationSourceSnapshot } from "../../modules/multiformat-engine/domain/types";
import { AdaptationError } from "../../modules/multiformat-engine/errors";
import type { MultiFormatSourceResolver } from "../../modules/multiformat-engine/source/source-resolver";
import { sha256Hex } from "../../modules/multiformat-engine/serialization/hash-adaptation";
import { buildSceneGraph } from "../../modules/visual-motion-engine/serialization/scene-graph";
import { db } from "../../prisma/db";

type WritingVariantRow = {
  id: string;
  documentId: string;
  label: string;
  text: string;
  textSha256: string;
};

type WritingDocumentRow = {
  id: string;
  projectId: string;
};

export type PostgresSourceResolverDeps = {
  writing: WritingRepository;
  images: ImageGenerationRepository;
  visuals: VisualRepository;
};

/** Collects a stored image into memory; CP17's artifacts are local files. */
async function readImageBytes(storageKey: string): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of imageStorage.read(storageKey)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks);
}

/**
 * Resolves CP19's three source kinds out of the tables that already own them.
 *
 * CP19 never copies a source into its own storage and never rewrites one. It asks
 * CP18, CP17 and CP14 for the current state of the thing being adapted and then
 * freezes that into a snapshot, which is the only thing a batch ever reads again.
 *
 * The one place it reads a table directly is the writing variant lookup: CP18's
 * `getVariant` is keyed by document id, and a CP19 request only ever holds a
 * variant id. The project check is done here against the owning document, so a
 * variant id from another project resolves to nothing rather than to text.
 */
export class PostgresSourceResolver implements MultiFormatSourceResolver {
  private readonly writing: WritingRepository;
  private readonly images: ImageGenerationRepository;
  private readonly visuals: VisualRepository;

  constructor(deps: PostgresSourceResolverDeps) {
    this.writing = deps.writing;
    this.images = deps.images;
    this.visuals = deps.visuals;
  }

  async resolve(input: {
    projectId: string;
    sourceType: "WRITING_VARIANT" | "GENERATED_IMAGE" | "VISUAL_COMPOSITION";
    sourceId: string;
  }): Promise<AdaptationSourceSnapshot> {
    if (input.sourceType === "WRITING_VARIANT") {
      return this.resolveWriting(input.projectId, input.sourceId);
    }

    if (input.sourceType === "GENERATED_IMAGE") {
      return this.resolveImage(input.projectId, input.sourceId);
    }

    return this.resolveComposition(input.projectId, input.sourceId);
  }

  async readSourceBytes(input: {
    projectId: string;
    snapshot: AdaptationSourceSnapshot;
  }): Promise<Buffer> {
    if (input.snapshot.sourceType !== "GENERATED_IMAGE") {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        `A ${input.snapshot.sourceType} has no bytes to read`,
        422,
      );
    }

    const asset = await this.images.getAsset(
      input.projectId,
      input.snapshot.assetId,
    );

    if (!asset || asset.deletedAt) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_NOT_FOUND",
        "The image this adaptation was planned from no longer exists",
        409,
      );
    }

    if (asset.storageKey !== input.snapshot.storageKey) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_CHANGED_SINCE_SNAPSHOT",
        "The image this adaptation was planned from now points at different bytes",
        409,
      );
    }

    return readImageBytes(asset.storageKey);
  }

  private async resolveWriting(
    projectId: string,
    variantId: string,
  ): Promise<AdaptationSourceSnapshot> {
    const variant = (await db.orm.public.WritingVariant.where({
      id: variantId,
    }).first()) as unknown as WritingVariantRow | null;

    if (!variant) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_NOT_FOUND",
        "Writing variant not found",
        404,
      );
    }

    const document = (await db.orm.public.WritingDocument.where({
      id: variant.documentId,
    }).first()) as unknown as WritingDocumentRow | null;

    if (!document || document.projectId !== projectId) {
      // Another project's variant id is indistinguishable from a missing one.
      throw new AdaptationError(
        "ADAPTATION_SOURCE_NOT_FOUND",
        "Writing variant not found",
        404,
      );
    }

    const claims = await this.writing.listClaims(
      projectId,
      variant.documentId,
      { variantId },
    );

    return {
      sourceType: "WRITING_VARIANT",
      variantId: variant.id,
      documentId: variant.documentId,
      label: variant.label,
      text: variant.text,
      textSha256: variant.textSha256 || sha256Hex(variant.text),
      claims: claims.map((claim) => ({
        text: claim.text,
        status: claim.status,
        // Only CP06 sources travel; the claim row's own ids are CP18's business.
        sourceIds: [...claim.sourceIds],
      })),
    };
  }

  private async resolveImage(
    projectId: string,
    assetId: string,
  ): Promise<AdaptationSourceSnapshot> {
    const asset = await this.images.getAsset(projectId, assetId);

    if (!asset || asset.deletedAt) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_NOT_FOUND",
        "Image not found",
        404,
      );
    }

    // Transparency is read from the actual pixels rather than believed from the
    // generation record: `IMAGE_TRANSPARENT` has to know whether there is alpha to
    // preserve, and only the file itself can say for certain.
    const bytes = await readImageBytes(asset.storageKey);
    const metadata = await inspectImage(bytes);
    const transparent = await hasTransparentPixels(bytes);

    return {
      sourceType: "GENERATED_IMAGE",
      assetId: asset.id,
      storageKey: asset.storageKey,
      mimeType: asset.mimeType,
      width: metadata.width || asset.width,
      height: metadata.height || asset.height,
      checksumSha256: asset.checksumSha256 || sha256Hex(bytes),
      transparent,
    };
  }

  private async resolveComposition(
    projectId: string,
    compositionId: string,
  ): Promise<AdaptationSourceSnapshot> {
    const composition = await this.visuals.getComposition(projectId, compositionId);

    if (!composition) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_NOT_FOUND",
        "Composition not found",
        404,
      );
    }

    // CP14 owns the layer-to-scene-graph mapping, so it is reused rather than
    // reimplemented: a layer added in CP14 must reach a CP19 video unchanged.
    const sceneGraph = buildSceneGraph(composition);

    return {
      sourceType: "VISUAL_COMPOSITION",
      compositionId: composition.id,
      width: sceneGraph.width,
      height: sceneGraph.height,
      frameRate: sceneGraph.frameRate,
      durationMs: sceneGraph.durationMs,
      layers: sceneGraph.layers,
    };
  }
}
