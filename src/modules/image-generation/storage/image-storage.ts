import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ImageExecutionError } from "../errors";

export type StoredImageArtifact = {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
};

export interface ImageStorage {
  putBytes(key: string, bytes: Buffer): Promise<StoredImageArtifact>;
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

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Generated images live in their own root, beside renders and audio but never
 * inside them, so clearing one kind can never touch another. Keys are built from
 * ids, never taken from a request, and a key read back from the database is
 * still resolved inside the root before it is opened.
 */
export class LocalImageStorage implements ImageStorage {
  private readonly root: string;

  constructor(root = path.join(process.cwd(), ".content-os", "images")) {
    this.root = root;
  }

  async putBytes(key: string, bytes: Buffer): Promise<StoredImageArtifact> {
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
      throw new ImageExecutionError("Invalid image storage key");
    }

    const absolute = path.resolve(this.root, key);
    if (!isWithinRoot(this.root, key)) {
      throw new ImageExecutionError(
        "Refusing to touch a path outside image storage",
      );
    }

    return absolute;
  }
}

export const imageStorage = new LocalImageStorage();

/** Content-addressed by job/asset, with an extension from the format. */
export function imageArtifactStorageKey(
  projectId: string,
  ownerId: string,
  extension: "png" | "jpg",
): string {
  return [
    safeSegment(projectId),
    safeSegment(ownerId),
    `output.${extension}`,
  ].join("/");
}
