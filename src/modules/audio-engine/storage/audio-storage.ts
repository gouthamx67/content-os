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
import { AudioExecutionError } from "../errors";

export type StoredAudioArtifact = {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
};

export interface AudioStorage {
  putBytes(key: string, bytes: Buffer): Promise<StoredAudioArtifact>;

  putFile(key: string, sourcePath: string): Promise<StoredAudioArtifact>;

  read(storageKey: string): Readable;

  delete(storageKey: string): Promise<void>;

  exists(storageKey: string): Promise<boolean>;

  absolutePath(storageKey: string): string;
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
 * Audio artifacts live in their own root, beside captures but never inside them,
 * so deleting a project's audio can never touch a captured take. Keys are built
 * from ids and are never taken from a request; a key read back from the database
 * is still resolved inside the root before it is opened.
 */
export class LocalAudioStorage implements AudioStorage {
  private readonly root: string;

  constructor(root = path.join(process.cwd(), ".content-os", "audio")) {
    this.root = root;
  }

  async putBytes(key: string, bytes: Buffer): Promise<StoredAudioArtifact> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, bytes, { mode: 0o600 });

    return {
      storageKey: key,
      byteSize: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async putFile(key: string, sourcePath: string): Promise<StoredAudioArtifact> {
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
      throw new AudioExecutionError("Invalid audio storage key");
    }

    const absolute = path.resolve(this.root, key);
    if (!isWithinRoot(this.root, key)) {
      throw new AudioExecutionError(
        "Refusing to touch a path outside audio storage",
      );
    }

    return absolute;
  }
}

export const audioStorage = new LocalAudioStorage();

/**
 * Audio artifacts are content-addressed by job, with an extension chosen from
 * the output format. The digest is not known until the mix finishes, so the key
 * is stable per job and the bytes are only written once.
 */
export function audioArtifactStorageKey(
  projectId: string,
  audioRenderJobId: string,
  extension: "wav" | "mp4",
): string {
  return [
    safeSegment(projectId),
    safeSegment(audioRenderJobId),
    `output.${extension}`,
  ].join("/");
}
