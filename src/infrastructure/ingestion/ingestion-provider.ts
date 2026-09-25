import { createHash } from "node:crypto";
import {
  InputError,
  type InputKind,
  type InputLimits,
  type JsonObject,
  type NormalizedInput,
} from "../../core/domain/input";
import type { AcquiredInput, InputProvider } from "../../core/domain/input-provider";
import { validateZipArchive } from "./archive";
import type { PublicFetchOptions, PublicFetchResult } from "./safe-http";

export interface PublicResourceFetcher {
  fetch(url: string, options: PublicFetchOptions): Promise<PublicFetchResult>;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function imageSignature(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70]) && String.fromCharCode(...bytes.slice(4, 12)) === "ftypavif") {
    return "image/avif";
  }
  return null;
}

function validVideoSignature(bytes: Uint8Array): boolean {
  return (
    (startsWith(bytes, [0x66, 0x74, 0x79, 0x70]) && bytes.byteLength >= 12) ||
    startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) ||
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      String.fromCharCode(...bytes.slice(8, 12)) === "AVI ")
  );
}

function validAudioSignature(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x49, 0x44, 0x33]) ||
    startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]) ||
    startsWith(bytes, [0x66, 0x4c, 0x61, 0x43]) ||
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE") ||
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
  );
}

function validateText(bytes: Uint8Array): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InputError("DOCUMENT_PARSE_FAILED", "Text document is not valid UTF-8");
  }
}

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".pages": "application/octet-stream",
  ".rtf": "application/rtf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function storedMimeType(kind: InputKind, name: string, validation: JsonObject, supplied: string): string {
  const detected = validation["detectedMimeType"];
  if (typeof detected === "string") return detected;
  if (kind === "pdf") return "application/pdf";
  if (kind === "zip") return "application/zip";
  if (kind === "text") return "text/plain; charset=utf-8";
  if (kind === "figma") {
    return /^application\/(?:vnd\.figma|x-figma)$/i.test(supplied) ? supplied : "application/octet-stream";
  }
  if (kind === "video" && /^video\//i.test(supplied)) return supplied;
  if (kind === "audio" && /^audio\//i.test(supplied)) return supplied;
  if (kind === "document") {
    return DOCUMENT_MIME_TYPES[name.toLowerCase().slice(name.lastIndexOf("."))] ?? "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

async function validateFileBytes(
  kind: InputKind,
  name: string,
  bytes: Uint8Array,
  limits: InputLimits,
): Promise<JsonObject> {
  if (bytes.byteLength === 0) throw new InputError("INVALID_FILE", "Input file is empty");
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new InputError("FILE_TOO_LARGE", "Input file exceeds the size limit");
  }

  if (kind === "pdf") {
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      throw new InputError("INVALID_FILE", "PDF signature is invalid");
    }
    return { validation: "pdf_signature" };
  }
  if (kind === "zip") {
    const archive = await validateZipArchive(bytes, {
      maxArchiveBytes: Math.min(limits.maxFileBytes, limits.maxArchiveBytes),
      maxEntryBytes: limits.maxArchiveEntryBytes,
      maxEntries: limits.maxArchiveEntries,
      maxExpandedBytes: limits.maxArchiveExpandedBytes,
    });
    return {
      validation: "zip_entries",
      archiveEntryCount: archive.entryCount,
      archiveExpandedBytes: archive.expandedBytes,
      archiveManifestHash: createHash("sha256").update(JSON.stringify(archive.files)).digest("hex"),
    };
  }
  if (kind === "image") {
    const signature = imageSignature(bytes);
    if (!signature) throw new InputError("INVALID_FILE", "Image signature is invalid");
    return { validation: "image_signature", detectedMimeType: signature };
  }
  if (kind === "video") {
    if (!validVideoSignature(bytes)) throw new InputError("INVALID_FILE", "Video signature is invalid");
    return { validation: "video_signature" };
  }
  if (kind === "audio") {
    if (!validAudioSignature(bytes)) throw new InputError("INVALID_FILE", "Audio signature is invalid");
    return { validation: "audio_signature" };
  }
  if (kind === "document") {
    const lower = name.toLowerCase();
    if ([".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"].some((extension) => lower.endsWith(extension))) {
      const archive = await validateZipArchive(bytes, {
        maxArchiveBytes: Math.min(limits.maxFileBytes, limits.maxArchiveBytes),
        maxEntryBytes: limits.maxArchiveEntryBytes,
        maxEntries: limits.maxArchiveEntries,
        maxExpandedBytes: limits.maxArchiveExpandedBytes,
      });
      const required = lower.endsWith(".docx")
        ? "word/"
        : lower.endsWith(".pptx")
          ? "ppt/"
          : lower.endsWith(".xlsx")
            ? "xl/"
            : "mimetype";
      if (!archive.files.some((file) => file.path.startsWith(required))) {
        throw new InputError("DOCUMENT_PARSE_FAILED", "Office document structure is invalid");
      }
      return { validation: "office_open_xml", archiveEntryCount: archive.entryCount };
    }
    if (lower.endsWith(".doc")) {
      if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
        throw new InputError("DOCUMENT_PARSE_FAILED", "Legacy Word document is invalid");
      }
      return { validation: "ole_compound_document" };
    }
    if (lower.endsWith(".rtf")) {
      if (!startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) {
        throw new InputError("DOCUMENT_PARSE_FAILED", "RTF document is invalid");
      }
      return { validation: "rtf_header" };
    }
    validateText(bytes);
    return { validation: "utf8_text" };
  }
  if (kind === "text") {
    validateText(bytes);
    return { validation: "utf8_text" };
  }
  if (kind === "figma") return { validation: "unprocessed_reference" };
  return { validation: "raw_bytes" };
}

function parseRepositoryPath(value: string): string {
  return new URL(value).pathname.replace(/^\/+|\/+$/g, "");
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new InputError("REPOSITORY_UNAVAILABLE", "Repository metadata response was invalid");
  }
}

function defaultBranch(value: Record<string, unknown>): string {
  if (typeof value.default_branch !== "string" || value.default_branch.length === 0 || value.default_branch.length > 255) {
    throw new InputError("REPOSITORY_UNAVAILABLE", "Repository default branch was invalid");
  }
  return value.default_branch;
}

function repositoryError(error: unknown): never {
  if (error instanceof InputError && (error.code.startsWith("ARCHIVE_") || error.code === "FILE_TOO_LARGE")) {
    throw error;
  }
  throw new InputError("REPOSITORY_UNAVAILABLE", "Public repository could not be acquired");
}

async function acquireRepository(
  input: Extract<NormalizedInput, { origin: "repository" }>,
  limits: InputLimits,
  fetcher: PublicResourceFetcher,
  signal?: AbortSignal,
): Promise<AcquiredInput> {
  const path = parseRepositoryPath(input.value);
  try {
    if (input.kind === "github") {
      const apiUrl = `https://api.github.com/repos/${path}`;
      const metadata = await fetcher.fetch(apiUrl, {
        maxBytes: Math.min(limits.maxRepositoryBytes, 1024 * 1024),
        maxRedirects: limits.maxRedirects,
        timeoutMs: limits.requestTimeoutMs,
        headers: { accept: "application/vnd.github+json" },
        signal,
      });
      const branch = defaultBranch(parseJsonObject(metadata.body));
      const archive = await fetcher.fetch(`${apiUrl}/zipball/${encodeURIComponent(branch)}`, {
        maxBytes: limits.maxRepositoryBytes,
        maxRedirects: limits.maxRedirects,
        timeoutMs: limits.requestTimeoutMs,
        headers: { accept: "application/vnd.github+json" },
        signal,
      });
      const validation = await validateFileBytes("zip", "repository.zip", archive.body, {
        ...limits,
        maxFileBytes: limits.maxRepositoryBytes,
      });
      return {
        kind: input.kind,
        name: input.name,
        mimeType: archive.contentType ?? "application/zip",
        bytes: archive.body,
        metadata: {
          provider: "github",
          defaultBranch: branch,
          archiveUrl: archive.url,
          ...validation,
        },
      };
    }

    const project = encodeURIComponent(path);
    const metadata = await fetcher.fetch(`https://gitlab.com/api/v4/projects/${project}`, {
      maxBytes: Math.min(limits.maxRepositoryBytes, 1024 * 1024),
      maxRedirects: limits.maxRedirects,
      timeoutMs: limits.requestTimeoutMs,
      headers: { accept: "application/json" },
      signal,
    });
    const branch = defaultBranch(parseJsonObject(metadata.body));
    const archive = await fetcher.fetch(
      `https://gitlab.com/api/v4/projects/${project}/repository/archive.zip?sha=${encodeURIComponent(branch)}`,
      {
        maxBytes: limits.maxRepositoryBytes,
        maxRedirects: limits.maxRedirects,
        timeoutMs: limits.requestTimeoutMs,
        signal,
      },
    );
    const validation = await validateFileBytes("zip", "repository.zip", archive.body, {
      ...limits,
      maxFileBytes: limits.maxRepositoryBytes,
    });
    return {
      kind: input.kind,
      name: input.name,
      mimeType: archive.contentType ?? "application/zip",
      bytes: archive.body,
      metadata: {
        provider: "gitlab",
        defaultBranch: branch,
        archiveUrl: archive.url,
        ...validation,
      },
    };
  } catch (error) {
    return repositoryError(error);
  }
}

async function acquireFolder(input: Extract<NormalizedInput, { origin: "folder" }>, limits: InputLimits): Promise<AcquiredInput> {
  const files = input.files
    .slice()
    .sort((left, right) => (left.relativePath ?? "").localeCompare(right.relativePath ?? ""));
  const projectedBytes = files.reduce((total, file) => {
    const metadata = JSON.stringify({
      path: file.relativePath,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      sha256: "0".repeat(64),
      ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
    });
    return total + new TextEncoder().encode(metadata).byteLength + Math.ceil(file.bytes.byteLength / 3) * 4 + 32;
  }, 128);
  if (projectedBytes > limits.maxArchiveExpandedBytes) {
    throw new InputError("ARCHIVE_TOO_LARGE", "Local project bundle exceeds the size limit");
  }
  const manifestFiles = files.map((file) => ({
    path: file.relativePath,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.bytes.byteLength,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
    content: Buffer.from(file.bytes).toString("base64"),
  }));
  const bundle = {
    format: "content-os.local-project",
    version: 1,
    files: manifestFiles,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  if (bytes.byteLength > limits.maxArchiveExpandedBytes) {
    throw new InputError("ARCHIVE_TOO_LARGE", "Local project bundle exceeds the size limit");
  }
  return {
    kind: "local_project",
    name: input.name,
    mimeType: "application/vnd.content-os.local-project+json",
    bytes,
    metadata: {
      validation: "local_project_manifest",
      fileCount: files.length,
    },
  };
}

export class IngestionInputProvider implements InputProvider {
  constructor(private readonly fetcher: PublicResourceFetcher) {}

  async acquire(
    input: NormalizedInput,
    limits: InputLimits,
    signal?: AbortSignal,
  ): Promise<AcquiredInput> {
    if (input.origin === "repository") return acquireRepository(input, limits, this.fetcher, signal);
    if (input.origin === "folder") return acquireFolder(input, limits);
    if (input.origin === "clipboard") {
      const bytes = new TextEncoder().encode(input.value);
      return { kind: "text", name: input.name, mimeType: "text/plain; charset=utf-8", bytes, metadata: {} };
    }
    if (input.origin === "url" && input.kind === "figma") {
      throw new InputError("INVALID_INPUT", "Figma URL references are stored without acquisition");
    }

    let bytes: Uint8Array;
    let mimeType: string;
    let metadata: JsonObject = {};
    if (input.origin === "url") {
      const fetched = await this.fetcher.fetch(input.value, {
        maxBytes: limits.maxUrlBytes,
        maxRedirects: limits.maxRedirects,
        timeoutMs: limits.requestTimeoutMs,
        signal,
      });
      bytes = fetched.body;
      const contentType = fetched.contentType?.split(";", 1)[0]?.trim() || "application/octet-stream";
      mimeType = contentType;
      metadata = { finalUrl: fetched.url, contentType };
    } else {
      bytes = input.file.bytes;
      mimeType = input.file.mimeType || "application/octet-stream";
      metadata = { originalName: input.file.name };
    }

    let validation: JsonObject = {};
    if (input.kind !== "website" && input.kind !== "web_app") {
      validation = await validateFileBytes(input.kind, input.name, bytes, limits);
      metadata = { ...metadata, ...validation };
      if (input.origin === "upload") {
        mimeType = storedMimeType(input.kind, input.name, validation, mimeType);
      }
    }
    return { kind: input.kind, name: input.name, mimeType, bytes, metadata };
  }
}
