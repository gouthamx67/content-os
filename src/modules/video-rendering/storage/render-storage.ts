import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { RenderExecutionError } from "../errors";

export type StoredArtifact = {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
};

export interface RenderStorage {
  putBytes(key: string, bytes: Buffer): Promise<StoredArtifact>;

  putFile(key: string, sourcePath: string): Promise<StoredArtifact>;

  read(storageKey: string): Readable;

  delete(storageKey: string): Promise<void>;

  exists(storageKey: string): Promise<boolean>;
}

function isWithinRoot(root: string, storageKey: string): boolean {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, storageKey);
  return (
    absolutePath === absoluteRoot ||
    absolutePath.startsWith(absoluteRoot + path.sep)
  );
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function checksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

/**
 * Render artifacts live beside captures but in their own root, so deleting a
 * composition's renders can never touch a captured take. Keys are built here
 * from a render job id and are never taken from a request; a key read back from
 * the database is still resolved inside the root before it is opened.
 */
export class LocalRenderStorage implements RenderStorage {
  private readonly root: string;

  constructor(root = path.join(process.cwd(), ".content-os", "renders")) {
    this.root = root;
  }

  async putBytes(key: string, bytes: Buffer): Promise<StoredArtifact> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, bytes, { mode: 0o600 });

    return {
      storageKey: key,
      byteSize: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async putFile(key: string, sourcePath: string): Promise<StoredArtifact> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });

    const temporary = `${absolute}.${process.pid}.tmp`;
    await copyFile(sourcePath, temporary);
    await rename(temporary, absolute);

    const info = await stat(absolute);
    return {
      storageKey: key,
      byteSize: info.size,
      checksumSha256: await checksum(absolute),
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

  /**
   * Resolves a key under the root. It is public so the worker can hand a stored
   * artifact to ffprobe without a second copy, but callers outside this module
   * must never send the result to a client.
   */
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
      throw new RenderExecutionError("Invalid render storage key");
    }

    const absolute = path.resolve(this.root, key);
    if (!isWithinRoot(this.root, key)) {
      throw new RenderExecutionError(
        "Refusing to touch a path outside render storage",
      );
    }

    return absolute;
  }
}

export const renderStorage = new LocalRenderStorage();

export function artifactStorageKey(
  projectId: string,
  renderJobId: string,
): string {
  return [safeSegment(projectId), `${safeSegment(renderJobId)}.mp4`].join("/");
}
