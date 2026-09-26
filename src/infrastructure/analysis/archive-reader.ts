import { fromBufferPromise, type Entry, type ZipFile } from "yauzl";

export interface RepositoryFile {
  path: string;
  text: string;
}

export interface RepositoryInspection {
  files: RepositoryFile[];
  fileCount: number;
  notes: string[];
}

export interface ArchiveReadLimits {
  maxEntries: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ARCHIVE_READ_LIMITS: ArchiveReadLimits = {
  maxEntries: 2_000,
  maxFiles: 60,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
};

const INTERESTING_PATH =
  /(readme|package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|cargo\.toml|composer\.json|gemfile|pom\.xml|build\.gradle|dockerfile|makefile|\.md$|\.txt$|\.ya?ml$|\.json$|\.toml$)/i;

const SKIPPED_PATH =
  /(node_modules|package-lock\.json|yarn\.lock|pnpm-lock\.cargo\.lock|\.min\.(?:js|css)$|\.map$|(^|\/)(?:dist|build|out|coverage|\.next|target|vendor)\/)/i;

const LOCAL_PROJECT_MIME = "application/vnd.content-os.local-project+json";

function isSafePath(path: string): boolean {
  if (!path || path.length > 1_024) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function shouldRead(path: string): boolean {
  if (SKIPPED_PATH.test(path)) return false;
  return INTERESTING_PATH.test(path);
}

function decodeSafe(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

function nextEntry(archive: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("end", onEnd);
      archive.off("error", onError);
    };
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
    archive.once("entry", onEntry);
    archive.once("end", onEnd);
    archive.once("error", onError);
    archive.readEntry();
  });
}

async function readEntryBytes(
  archive: ZipFile,
  entry: Entry,
  maxBytes: number,
): Promise<Buffer | null> {
  if (entry.uncompressedSize > maxBytes) return null;
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        stream.destroy();
        reject(new Error("ARCHIVE_FILE_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return Buffer.concat(chunks);
}

export async function readZipTextFiles(
  bytes: Uint8Array,
  limits: ArchiveReadLimits = DEFAULT_ARCHIVE_READ_LIMITS,
): Promise<RepositoryInspection> {
  const notes: string[] = [];
  const files: RepositoryFile[] = [];
  const archive = await fromBufferPromise(Buffer.from(bytes), {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });

  let fileCount = 0;
  let entryCount = 0;
  let totalBytes = 0;
  let entry: Entry | null;

  while ((entry = await nextEntry(archive)) !== null) {
    entryCount += 1;
    if (entryCount > limits.maxEntries) {
      notes.push(`Stopped reading the archive after ${limits.maxEntries} entries`);
      break;
    }
    if (entry.fileName.endsWith("/")) continue;
    fileCount += 1;

    const decoded = decodeSafe(entry.fileName);
    if (decoded === null) continue;
    if (!isSafePath(decoded)) {
      notes.push("Skipped an archive entry with an unsafe path");
      continue;
    }
    if (entry.isEncrypted()) continue;
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) continue;
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === 0o120000) continue;

    if (files.length >= limits.maxFiles || totalBytes >= limits.maxTotalBytes) continue;
    if (!shouldRead(decoded)) continue;

    const remaining = limits.maxTotalBytes - totalBytes;
    const content = await readEntryBytes(archive, entry, Math.min(limits.maxFileBytes, remaining));
    if (content === null) continue;
    totalBytes += content.byteLength;
    files.push({ path: decoded, text: content.toString("utf8") });
  }

  if (entryCount < fileCount) {
    notes.push("The archive ended before every entry could be enumerated");
  }
  return { files, fileCount, notes };
}

interface LocalProjectFile {
  path?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  content?: unknown;
}

function readLocalProjectBundle(
  bytes: Uint8Array,
  limits: ArchiveReadLimits,
): RepositoryInspection {
  const notes: string[] = [];
  const files: RepositoryFile[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } catch {
    return { files, fileCount: 0, notes: ["The local project bundle is not valid JSON"] };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { files, fileCount: 0, notes: ["The local project bundle has an unexpected shape"] };
  }

  const manifest = (parsed as { files?: unknown }).files;
  if (!Array.isArray(manifest)) {
    return { files, fileCount: 0, notes: ["The local project bundle has no file list"] };
  }

  let fileCount = 0;
  let totalBytes = 0;
  for (const rawEntry of manifest) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as LocalProjectFile;
    fileCount += 1;
    if (files.length >= limits.maxFiles || totalBytes >= limits.maxTotalBytes) continue;
    if (typeof entry.path !== "string" || typeof entry.content !== "string") continue;
    if (!isSafePath(entry.path)) {
      notes.push("Skipped a bundle file with an unsafe path");
      continue;
    }
    if (entry.mimeType === LOCAL_PROJECT_MIME) continue;
    if (!shouldRead(entry.path)) continue;

    const decodedBase64 = decodeBase64(entry.content);
    if (decodedBase64 === null) continue;
    const size = decodedBase64.byteLength;
    if (size > limits.maxFileBytes || totalBytes + size > limits.maxTotalBytes) continue;
    totalBytes += size;
    files.push({ path: entry.path, text: new TextDecoder("utf-8", { fatal: false }).decode(decodedBase64) });
  }

  return { files, fileCount, notes };
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

export async function inspectRepositorySource(
  bytes: Uint8Array,
  mimeType: string | null,
  limits: ArchiveReadLimits = DEFAULT_ARCHIVE_READ_LIMITS,
): Promise<RepositoryInspection> {
  if (mimeType === LOCAL_PROJECT_MIME) {
    return readLocalProjectBundle(bytes, limits);
  }
  const inspection = await readZipTextFiles(bytes, limits);
  if (inspection.files.length === 0 && inspection.notes.length === 0) {
    inspection.notes.push("The archive contained no readable text files of interest");
  }
  return inspection;
}
