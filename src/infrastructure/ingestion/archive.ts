import { createHash } from "node:crypto";
import { InputError } from "../../core/domain/input";
import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
}

export interface ArchiveFile {
  path: string;
  sizeBytes: number;
  compressedSizeBytes: number;
  sha256: string;
}

export interface ArchiveInspection {
  entryCount: number;
  expandedBytes: number;
  files: ArchiveFile[];
}

function unsafePath(value: string): boolean {
  const candidate = value.endsWith("/") ? value.slice(0, -1) : value;
  return (
    !candidate ||
    candidate.length > 1_024 ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    candidate.startsWith("/") ||
    /^[a-zA-Z]:/.test(candidate) ||
    candidate.split("/").some((segment) => !segment || segment === "." || segment === "..")
  );
}

function assertSafeEntryPath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new InputError("ARCHIVE_UNSAFE_PATH", "Archive contains an invalid path");
  }

  const normalized = decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
  if (unsafePath(path) || unsafePath(normalized)) {
    throw new InputError("ARCHIVE_UNSAFE_PATH", "Archive contains an unsafe path");
  }
  return normalized;
}

function assertSafeEntry(entry: Entry): string {
  const path = assertSafeEntryPath(entry.fileName);
  if (entry.isEncrypted()) {
    throw new InputError("ARCHIVE_INVALID", "Encrypted archives are not supported");
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new InputError("ARCHIVE_INVALID", "Archive uses an unsupported compression method");
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if ((unixMode & 0o170000) === 0o120000) {
    throw new InputError("ARCHIVE_UNSAFE_PATH", "Archive symbolic links are not supported");
  }
  return path;
}

function nextEntry(archive: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("end", onEnd);
      archive.off("error", onError);
    };
    archive.once("entry", onEntry);
    archive.once("end", onEnd);
    archive.once("error", onError);
    archive.readEntry();
  });
}

async function hashEntry(archive: ZipFile, entry: Entry, path: string): Promise<ArchiveFile> {
  const stream = await archive.openReadStreamPromise(entry);
  const hash = createHash("sha256");
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });

  if (size !== entry.uncompressedSize) {
    throw new InputError("ARCHIVE_INVALID", "Archive entry size validation failed");
  }
  return {
    path,
    sizeBytes: size,
    compressedSizeBytes: entry.compressedSize,
    sha256: hash.digest("hex"),
  };
}

export async function validateZipArchive(
  bytes: Uint8Array,
  limits: ArchiveLimits,
): Promise<ArchiveInspection> {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new InputError("ARCHIVE_TOO_LARGE", "Archive exceeds the size limit");
  }
  if (bytes.byteLength < 4) {
    throw new InputError("ARCHIVE_INVALID", "Archive is invalid");
  }

  try {
    const archive = await fromBufferPromise(Buffer.from(bytes), {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    if (archive.entryCount === 0 || archive.entryCount > limits.maxEntries) {
      throw new InputError("ARCHIVE_TOO_LARGE", "Archive contains too many entries");
    }

    const files: ArchiveFile[] = [];
    const seenPaths = new Set<string>();
    let expandedBytes = 0;
    let entryCount = 0;
    let entry: Entry | null;
    while ((entry = await nextEntry(archive)) !== null) {
      entryCount += 1;
      const path = assertSafeEntry(entry);
      if (seenPaths.has(path)) {
        throw new InputError("ARCHIVE_UNSAFE_PATH", "Archive contains duplicate paths");
      }
      seenPaths.add(path);
      if (entry.uncompressedSize > limits.maxEntryBytes) {
        throw new InputError("ARCHIVE_TOO_LARGE", "Archive entry exceeds the size limit");
      }
      expandedBytes += entry.uncompressedSize;
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > limits.maxExpandedBytes) {
        throw new InputError("ARCHIVE_TOO_LARGE", "Archive expands beyond the size limit");
      }
      if (!entry.fileName.endsWith("/")) {
        files.push(await hashEntry(archive, entry, path));
      }
    }
    if (entryCount !== archive.entryCount) {
      throw new InputError("ARCHIVE_INVALID", "Archive entry count validation failed");
    }
    return { entryCount, expandedBytes, files };
  } catch (error) {
    if (error instanceof InputError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("invalid relative path") ||
      message.includes("absolute path") ||
      message.includes("invalid characters in filename") ||
      message.includes("backslash")
    ) {
      throw new InputError("ARCHIVE_UNSAFE_PATH", "Archive contains an unsafe path");
    }
    throw new InputError("ARCHIVE_INVALID", "Archive could not be validated");
  }
}
