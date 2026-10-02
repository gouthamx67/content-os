import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface StoredCapture {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
}

export interface CaptureStorage {
  put(
    projectId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<StoredCapture>;

  read(storageKey: string): Readable;

  delete(storageKey: string): Promise<void>;

  /**
   * Whether the bytes are actually on disk. A record that points at a missing
   * object is not a persisted capture, so this is how a read can tell a deleted
   * file from a file it is merely slow to open.
   */
  exists(storageKey: string): Promise<boolean>;
}

/**
 * Storage keys are paths. They are built here and never accepted from a request,
 * but a key read back out of the database is still untrusted input until it has
 * been resolved inside the root: `..` would otherwise walk out of the per-project
 * directory and read any file the process can.
 */
export function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function isStorageKeyWithinRoot(root: string, storageKey: string): boolean {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, storageKey);

  return (
    absolutePath === absoluteRoot ||
    absolutePath.startsWith(absoluteRoot + path.sep)
  );
}

export class LocalCaptureStorage implements CaptureStorage {
  private readonly root: string;

  constructor(root = path.join(process.cwd(), ".content-os", "captures")) {
    this.root = root;
  }

  async put(
    projectId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<StoredCapture> {
    const projectSegment = safeSegment(projectId);
    const filenameSegment = safeSegment(filename || "capture.bin");

    const digest = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    // The digest is part of the key so two identical uploads are distinguishable
    // without a content-addressed store, and a re-upload can never overwrite an
    // accepted take that happens to share a filename.
    const storageKey = [
      projectSegment,
      `${Date.now()}-${digest.slice(0, 16)}-${filenameSegment}`,
    ].join("/");

    const absolutePath = path.join(this.root, storageKey);

    if (!isStorageKeyWithinRoot(this.root, storageKey)) {
      throw new Error("Refusing to write outside the capture root");
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);

    return {
      storageKey,
      byteSize: bytes.byteLength,
      checksumSha256: digest,
    };
  }

  read(storageKey: string) {
    const absolutePath = path.join(this.root, storageKey);

    if (!isStorageKeyWithinRoot(this.root, storageKey)) {
      throw new Error("Refusing to read outside the capture root");
    }

    return createReadStream(absolutePath);
  }

  async exists(storageKey: string): Promise<boolean> {
    if (!isStorageKeyWithinRoot(this.root, storageKey)) {
      return false;
    }

    try {
      const info = await stat(path.join(this.root, storageKey));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async delete(storageKey: string): Promise<void> {
    if (!isStorageKeyWithinRoot(this.root, storageKey)) {
      throw new Error("Refusing to delete outside the capture root");
    }

    const absolutePath = path.join(this.root, storageKey);

    try {
      await unlink(absolutePath);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : "";

      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export const captureStorage = new LocalCaptureStorage();
