import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { InputError } from "../../core/domain/input";
import type { StorageProvider, StoredObject } from "../../core/ports/storage-provider";

const MAX_READ_BYTES = 32 * 1024 * 1024;

function storageError(message: string): InputError {
  return new InputError("STORAGE_FAILED", message);
}

function validateKey(key: string): string[] {
  if (
    !key ||
    key.length > 1_024 ||
    key.includes("\\") ||
    key.includes("\0") ||
    isAbsolute(key) ||
    /^[a-zA-Z]:/.test(key)
  ) {
    throw storageError("Storage key is invalid");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw storageError("Storage key is invalid");
  }
  return segments;
}

function objectUri(key: string): string {
  return `content-os-storage://local/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer | Uint8Array, mimeType?: string): Promise<StoredObject> {
    const segments = validateKey(key);
    const root = await this.ensureRoot();
    const target = await this.resolveTarget(root, segments, true);
    if (!target) throw storageError("Storage path could not be created");
    const temporary = join(target.directory, `.${basename(target.file)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await rename(temporary, target.file);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw storageError("Input could not be stored");
    }
    return {
      uri: objectUri(key),
      key,
      size: data.byteLength,
      mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const segments = validateKey(key);
    const root = await this.ensureRoot();
    const target = await this.resolveTarget(root, segments, false);
    if (!target) return;
    try {
      const existing = await lstat(target.file);
      if (!existing.isFile() || existing.isSymbolicLink()) throw storageError("Stored object is invalid");
      await rm(target.file, { force: true });
    } catch (error) {
      if (error instanceof InputError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw storageError("Stored input could not be deleted");
    }
  }

  async get(key: string): Promise<Uint8Array> {
    const segments = validateKey(key);
    const root = await this.ensureRoot();
    const target = await this.resolveTarget(root, segments, false);
    if (!target) throw storageError("Stored object is unavailable");
    try {
      const stats = await lstat(target.file);
      if (!stats.isFile() || stats.isSymbolicLink()) throw storageError("Stored object is invalid");
      if (stats.size > MAX_READ_BYTES) throw storageError("Stored object is too large to analyze");
      return await readFile(target.file);
    } catch (error) {
      if (error instanceof InputError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw storageError("Stored object is unavailable");
      }
      throw storageError("Stored object could not be read");
    }
  }

  async getUrl(key: string): Promise<string> {
    validateKey(key);
    return objectUri(key);
  }

  private async ensureRoot(): Promise<string> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      return await realpath(this.root);
    } catch {
      throw storageError("Storage root is unavailable");
    }
  }

  private async resolveTarget(
    root: string,
    segments: readonly string[],
    create: boolean,
  ): Promise<{ directory: string; file: string } | null> {
    let directory = root;
    try {
      for (const segment of segments.slice(0, -1)) {
        const next = join(directory, segment);
        if (create) {
          await mkdir(next, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
        }
        const stats = await lstat(next);
        if (!stats.isDirectory() || stats.isSymbolicLink()) throw storageError("Storage path is invalid");
        const resolved = await realpath(next);
        if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
          throw storageError("Storage path escapes its root");
        }
        directory = resolved;
      }
      const file = join(directory, segments.at(-1) ?? "");
      const resolvedFile = resolve(file);
      if (!resolvedFile.startsWith(`${root}${sep}`)) throw storageError("Storage path escapes its root");
      if (!create) {
        const existing = await lstat(resolvedFile);
        if (existing.isSymbolicLink() || !existing.isFile()) throw storageError("Stored object is invalid");
      }
      return { directory, file: resolvedFile };
    } catch (error) {
      if (error instanceof InputError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (create) throw storageError("Storage path could not be created");
        return null;
      }
      throw storageError("Storage path is unavailable");
    }
  }
}
