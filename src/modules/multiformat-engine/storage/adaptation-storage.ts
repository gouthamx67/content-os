import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { AdaptationError } from "../errors";

export type StoredAdaptationArtifact = {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
};

export interface AdaptationStorage {
  putBytes(key: string, bytes: Buffer): Promise<StoredAdaptationArtifact>;
  read(storageKey: string): Readable;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  absolutePath(storageKey: string): string;
}

function isWithinRoot(root: string, storageKey: string): boolean {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, storageKey);
  return (
    absolute === absoluteRoot || absolute.startsWith(absoluteRoot + path.sep)
  );
}

/**
 * Adapted outputs live in their own root, beside generated images, renders and
 * audio but inside none of them.
 *
 * That separation is the point: CP19 writes derived artifacts, never canonical
 * source bytes, so clearing an adaptation cache can not touch a CP17 asset and a
 * video adaptation is not mistaken for a CP15 render. Keys are built from ids and
 * digests, never taken from a request, and every key read back from the database
 * is resolved inside the root before it is opened.
 */
export class LocalAdaptationStorage implements AdaptationStorage {
  private readonly root: string;

  constructor(root = path.join(process.cwd(), ".content-os", "multiformat")) {
    this.root = root;
  }

  async putBytes(key: string, bytes: Buffer): Promise<StoredAdaptationArtifact> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, bytes, { mode: 0o600 });

    return {
      storageKey: key,
      byteSize: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  read(storageKey: string): Readable {
    return createReadStream(this.resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const info = await stat(this.resolve(storageKey));
      return info.isFile();
    } catch {
      return false;
    }
  }

  absolutePath(storageKey: string): string {
    return this.resolve(storageKey);
  }

  private resolve(key: string): string {
    if (
      !key ||
      key.includes("..") ||
      key.includes("\\") ||
      key.includes("\0") ||
      path.isAbsolute(key)
    ) {
      throw new AdaptationError(
        "ADAPTATION_STORAGE_FAILED",
        "Invalid adaptation storage key",
        500,
      );
    }

    if (!isWithinRoot(this.root, key)) {
      throw new AdaptationError(
        "ADAPTATION_STORAGE_FAILED",
        "Refusing to touch a path outside adaptation storage",
        500,
      );
    }

    return path.resolve(this.root, key);
  }
}

export const adaptationStorage = new LocalAdaptationStorage();