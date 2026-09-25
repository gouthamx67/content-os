import {
  DEFAULT_INPUT_LIMITS,
  InputError,
  type InputLimits,
  type NormalizedInput,
  type NormalizedInputFile,
  type UploadInputKind,
} from "./input";

export interface RawInputFile {
  name: string;
  relativePath?: string;
  mimeType: string;
  bytes: Uint8Array;
  lastModified?: number;
}

export type RawInput =
  | {
      type: "url";
      value: string;
      kind?: "website" | "web_app" | "figma";
    }
  | {
      type: "repository";
      provider: "github" | "gitlab";
      value: string;
    }
  | {
      type: "text";
      value: string;
      name?: string;
    }
  | {
      type: "upload";
      file: RawInputFile;
      kind?: UploadInputKind;
    }
  | {
      type: "folder";
      name?: string;
      files: readonly RawInputFile[];
    };

export { DEFAULT_INPUT_LIMITS, InputError };
export type { InputLimits, NormalizedInput };

const DOCUMENT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".odt",
  ".odp",
  ".ods",
  ".pages",
  ".rtf",
  ".ppt",
  ".pptx",
  ".xlsx",
]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".sh",
  ".sql",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac", ".opus"]);

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function cleanName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned || fallback;
}

function fileBaseName(name: string): string {
  return name.split(/[\\/]/).at(-1) ?? name;
}

function urlName(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.hostname}${path}`.slice(0, 255);
}

function parseHttpUrl(value: string, code: "INVALID_URL" | "REPOSITORY_INVALID"): URL {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4_096) {
    throw new InputError(code, "Enter a valid URL");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InputError(code, "Enter a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new InputError(code, "Only credential-free HTTP or HTTPS URLs are supported");
  }
  return url;
}

function normalizeUrl(raw: Extract<RawInput, { type: "url" }>): NormalizedInput {
  const url = parseHttpUrl(raw.value, "INVALID_URL");
  const kind = raw.kind ?? "website";
  return {
    origin: "url",
    kind,
    value: url.href,
    name: urlName(url),
  };
}

function normalizeRepository(raw: Extract<RawInput, { type: "repository" }>): NormalizedInput {
  const url = parseHttpUrl(raw.value, "REPOSITORY_INVALID");
  const expectedHost = raw.provider === "github" ? "github.com" : "gitlab.com";
  if (url.hostname.toLowerCase() !== expectedHost || url.port) {
    throw new InputError("REPOSITORY_INVALID", `Use a public ${raw.provider}.com repository URL`);
  }

  const marker = raw.provider === "gitlab" ? "/-/" : "/tree/";
  const markerIndex = url.pathname.indexOf(marker);
  const repositoryPath = (markerIndex >= 0 ? url.pathname.slice(0, markerIndex) : url.pathname)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  const pathSegments = repositoryPath.split("/").filter(Boolean);
  if (raw.provider === "github" && markerIndex < 0 && pathSegments.length !== 2) {
    throw new InputError("REPOSITORY_INVALID", "GitHub URL must identify an owner and repository");
  }
  const segments = pathSegments;
  if (segments.length < 2 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new InputError("REPOSITORY_INVALID", "Repository URL must identify a public project");
  }

  const canonical = `${url.origin}/${segments.map(encodeURIComponent).join("/")}`;
  return {
    origin: "repository",
    kind: raw.provider,
    value: canonical,
    name: segments.join("/").slice(0, 255),
  };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function inferImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(bytes, [0xff, 0xd8, 0xff]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) ||
    startsWith(bytes, [0x42, 0x4d]) ||
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ||
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) ||
    (startsWith(bytes, [0x66, 0x74, 0x79, 0x70]) && String.fromCharCode(...bytes.slice(4, 12)) === "ftypavif")
  );
}

function detectUploadKind(file: RawInputFile, explicitKind?: UploadInputKind): UploadInputKind {
  if (explicitKind) return explicitKind;

  const ext = extension(file.name);
  const mime = file.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "application/octet-stream";
  if (mime === "application/pdf" || ext === ".pdf") {
    if (!startsWith(file.bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      throw new InputError("INVALID_FILE", "The uploaded PDF signature is invalid");
    }
    return "pdf";
  }
  if (mime === "application/zip" || ext === ".zip") {
    if (!startsWith(file.bytes, [0x50, 0x4b])) {
      throw new InputError("INVALID_FILE", "The uploaded ZIP signature is invalid");
    }
    return "zip";
  }
  if (
    mime === "application/vnd.figma" ||
    mime === "application/x-figma" ||
    ext === ".fig" ||
    ext === ".figma"
  ) {
    return "figma";
  }
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext) || inferImage(file.bytes)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    DOCUMENT_EXTENSIONS.has(ext) ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return "document";
  }

  throw new InputError("UNSUPPORTED_INPUT_TYPE", "This file type is not supported");
}

function normalizeRelativePath(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw new InputError("INVALID_FILE", "Folder paths must be safe relative paths");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new InputError("INVALID_FILE", "Folder paths must be valid relative paths");
  }
  const segments = decoded.split("/");
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    /^[a-zA-Z]:/.test(decoded) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new InputError("INVALID_FILE", "Folder paths cannot escape the selected folder");
  }
  return segments.join("/").slice(0, 1_024);
}

function normalizeFile(raw: RawInputFile, limits: InputLimits, relativePath?: string): NormalizedInputFile {
  if (!(raw.bytes instanceof Uint8Array)) {
    throw new InputError("INVALID_FILE", "Uploaded file content is required");
  }
  if (raw.bytes.byteLength > limits.maxFileBytes) {
    throw new InputError("FILE_TOO_LARGE", "The uploaded file exceeds the size limit");
  }
  if (raw.lastModified !== undefined && (!Number.isFinite(raw.lastModified) || raw.lastModified < 0)) {
    throw new InputError("INVALID_FILE", "The file modification time is invalid");
  }

  const safePath = relativePath === undefined ? undefined : normalizeRelativePath(relativePath);
  const name = cleanName(fileBaseName(safePath ?? raw.name), "Untitled input");
  return {
    name,
    ...(safePath === undefined ? {} : { relativePath: safePath }),
    mimeType: cleanName(raw.mimeType, "application/octet-stream").slice(0, 255).toLowerCase(),
    bytes: raw.bytes,
    ...(raw.lastModified === undefined ? {} : { lastModified: raw.lastModified }),
  };
}

function normalizeUpload(raw: Extract<RawInput, { type: "upload" }>, limits: InputLimits): NormalizedInput {
  const mimeType = raw.file.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "application/octet-stream";
  if (mimeType === "image/svg+xml" || extension(raw.file.name) === ".svg") {
    throw new InputError("INVALID_FILE", "SVG files are not supported");
  }
  const file = normalizeFile(raw.file, limits);
  return {
    origin: "upload",
    kind: detectUploadKind(raw.file, raw.kind),
    name: cleanName(raw.file.name.replace(/^.*[\\/]/, ""), file.name),
    file,
  };
}

function normalizeFolder(raw: Extract<RawInput, { type: "folder" }>, limits: InputLimits): NormalizedInput {
  if (raw.files.length === 0) {
    throw new InputError("INVALID_FILE", "Select at least one file in the folder");
  }
  if (raw.files.length > limits.maxFolderFiles) {
    throw new InputError("FILE_TOO_LARGE", "The folder contains too many files");
  }

  const files = raw.files
    .map((file) => normalizeFile(file, limits, file.relativePath ?? file.name))
    .sort((left, right) => (left.relativePath ?? "").localeCompare(right.relativePath ?? ""));
  const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  if (totalBytes > limits.maxFolderBytes) {
    throw new InputError("FILE_TOO_LARGE", "The selected folder exceeds the size limit");
  }
  if (new Set(files.map((file) => file.relativePath)).size !== files.length) {
    throw new InputError("INVALID_FILE", "Folder paths must be unique");
  }

  return {
    origin: "folder",
    kind: "local_project",
    name: cleanName(raw.name, files[0]?.relativePath?.split("/")[0] ?? "Local project"),
    files,
  };
}

function normalizeText(raw: Extract<RawInput, { type: "text" }>, limits: InputLimits): NormalizedInput {
  if (typeof raw.value !== "string" || raw.value.trim().length === 0) {
    throw new InputError("INVALID_INPUT", "Pasted text cannot be empty");
  }
  if (new TextEncoder().encode(raw.value).byteLength > limits.maxTextBytes) {
    throw new InputError("FILE_TOO_LARGE", "Pasted text exceeds the size limit");
  }
  return {
    origin: "clipboard",
    kind: "text",
    value: raw.value,
    name: cleanName(raw.name, "Pasted text"),
  };
}

export function normalizeInput(raw: RawInput, limits: InputLimits = DEFAULT_INPUT_LIMITS): NormalizedInput {
  switch (raw.type) {
    case "url":
      return normalizeUrl(raw);
    case "repository":
      return normalizeRepository(raw);
    case "upload":
      return normalizeUpload(raw, limits);
    case "folder":
      return normalizeFolder(raw, limits);
    case "text":
      return normalizeText(raw, limits);
  }
}

export function normalizeBatch(
  rawInputs: readonly RawInput[],
  limits: InputLimits = DEFAULT_INPUT_LIMITS,
): NormalizedInput[] {
  if (rawInputs.length === 0) {
    throw new InputError("INVALID_INPUT", "Add at least one input");
  }
  if (rawInputs.length > limits.maxBatchSize) {
    throw new InputError("INVALID_INPUT", `A batch can contain at most ${limits.maxBatchSize} inputs`);
  }
  return rawInputs.map((raw) => normalizeInput(raw, limits));
}

