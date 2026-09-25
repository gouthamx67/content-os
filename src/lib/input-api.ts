import {
  DEFAULT_INPUT_LIMITS,
  InputError,
  SOURCE_STATUS_TO_PUBLIC,
  SOURCE_TYPE_TO_INPUT_KIND,
  type InputOrigin,
  type JsonObject,
  type UploadInputKind,
} from "../core/domain/input";
import type { RawInput, RawInputFile } from "../core/domain/input-normalizer";
import type { Source } from "../core/domain/source";
import { HttpError, jsonError, wrapHttpError } from "./http";

const MAX_JSON_BODY_BYTES = 6 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = 150 * 1024 * 1024;

const MAX_BODY_CHUNKS = 8192;

async function readRequestBody(
  request: Request,
  maxBytes: number,
  message: string,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  let body = new Uint8Array(Math.min(maxBytes, 64 * 1024));
  let size = 0;
  let chunks = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!result.value) continue;
      chunks += 1;
      if (chunks > MAX_BODY_CHUNKS) {
        await reader.cancel().catch(() => undefined);
        throw new InputError("FILE_TOO_LARGE", message);
      }
      const required = size + result.value.byteLength;
      if (required > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new InputError("FILE_TOO_LARGE", message);
      }
      if (required > body.length) {
        const capacity = Math.min(maxBytes, Math.max(required, body.length * 2));
        const next = new Uint8Array(capacity);
        next.set(body.subarray(0, size));
        body = next;
      }
      body.set(result.value, size);
      size = required;
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("INVALID_INPUT", "Request body could not be read");
  } finally {
    reader.releaseLock();
  }

  return size === body.length ? body : body.slice(0, size);
}

function requestWithBody(request: Request, body: Uint8Array): Request {
  const buffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(buffer).set(body);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: buffer,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && "arrayBuffer" in value && "name" in value;
}

function parseJsonField(value: FormDataEntryValue | null, field: string): unknown {
  if (typeof value !== "string") {
    throw new InputError("INVALID_INPUT", `${field} must be JSON`);
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InputError("INVALID_INPUT", `${field} must be valid JSON`);
  }
}

const UPLOAD_KINDS = new Set([
  "zip",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "figma",
  "text",
]);

function isUploadKind(value: unknown): value is UploadInputKind {
  return typeof value === "string" && UPLOAD_KINDS.has(value);
}

function validateDescriptor(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    throw new InputError("INVALID_INPUT", "Each input must have a supported type");
  }

  const type = value["type"];
  if (type === "url") {
    if (typeof value["value"] !== "string") {
      throw new InputError("INVALID_INPUT", "URL inputs require a string value");
    }
    if (
      value["kind"] !== undefined &&
      !["website", "web_app", "figma"].includes(String(value["kind"]))
    ) {
      throw new InputError("INVALID_INPUT", "URL kind is invalid");
    }
  } else if (type === "repository") {
    if (typeof value["value"] !== "string" || !["github", "gitlab"].includes(String(value["provider"]))) {
      throw new InputError("INVALID_INPUT", "Repository provider and value are required");
    }
  } else if (type === "text") {
    if (typeof value["value"] !== "string" || (value["name"] !== undefined && typeof value["name"] !== "string")) {
      throw new InputError("INVALID_INPUT", "Text value and optional name must be strings");
    }
  } else if (type === "upload") {
    if (value["kind"] !== undefined && !isUploadKind(value["kind"])) {
      throw new InputError("INVALID_INPUT", "Upload kind is invalid");
    }
  } else if (type === "folder") {
    if (value["name"] !== undefined && typeof value["name"] !== "string") {
      throw new InputError("INVALID_INPUT", "Folder name must be a string");
    }
  } else {
    throw new InputError("UNSUPPORTED_INPUT_TYPE", "Input type is not supported");
  }
  return value;
}

function validateEnvelope(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value["inputs"])) {
    throw new InputError("INVALID_INPUT", "inputs must be an array");
  }

  if (value["inputs"].length === 0) {
    throw new InputError("INVALID_INPUT", "At least one input is required");
  }

  if (value["inputs"].length > DEFAULT_INPUT_LIMITS.maxBatchSize) {
    throw new InputError("INVALID_INPUT", "Too many inputs in one batch");
  }

  return value["inputs"].map(validateDescriptor);
}

async function fileToRawInput(file: File, relativePath?: string): Promise<RawInputFile> {
  if (file.size > DEFAULT_INPUT_LIMITS.maxFileBytes) {
    throw new InputError("FILE_TOO_LARGE", `${file.name} exceeds the file size limit`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > DEFAULT_INPUT_LIMITS.maxFileBytes) {
    throw new InputError("FILE_TOO_LARGE", `${file.name} exceeds the file size limit`);
  }

  return {
    name: file.name,
    relativePath,
    mimeType: file.type || "application/octet-stream",
    bytes,
    lastModified: file.lastModified || undefined,
  };
}

async function materializeMultipartDescriptor(
  descriptor: Record<string, unknown>,
  files: readonly File[],
  claimed: Set<number>,
): Promise<RawInput> {
  if (descriptor["type"] === "upload") {
    const index = descriptor["fileIndex"];
    if (!Number.isInteger(index) || typeof index !== "number" || index < 0 || index >= files.length || claimed.has(index)) {
      throw new InputError("INVALID_INPUT", "Upload fileIndex is invalid or already used");
    }
    claimed.add(index);
    const kind = descriptor["kind"];
    return {
      type: "upload",
      file: await fileToRawInput(files[index]),
      ...(isUploadKind(kind) ? { kind } : {}),
    };
  }

  if (descriptor["type"] === "folder") {
    const requested = descriptor["fileIndices"];
    const indices = Array.isArray(requested)
      ? requested
      : files.map((_file, index) => index).filter((index) => !claimed.has(index));

    if (
      indices.length === 0 ||
      indices.length > DEFAULT_INPUT_LIMITS.maxFolderFiles ||
      !indices.every(
        (index) => Number.isInteger(index) && typeof index === "number" && index >= 0 && index < files.length,
      )
    ) {
      throw new InputError("INVALID_INPUT", "Folder fileIndices are invalid");
    }

    if (new Set(indices).size !== indices.length || indices.some((index) => claimed.has(index))) {
      throw new InputError("INVALID_INPUT", "A file can belong to only one input");
    }

    indices.forEach((index) => claimed.add(index));
    const paths = Array.isArray(descriptor["paths"]) ? descriptor["paths"] : [];
    const folderFiles = await Promise.all(
      indices.map(async (index, position) => {
        const path = paths[position];
        return fileToRawInput(files[index], typeof path === "string" ? path : files[index].name);
      }),
    );
    const totalBytes = folderFiles.reduce((total, file) => total + file.bytes.byteLength, 0);
    if (totalBytes > DEFAULT_INPUT_LIMITS.maxFolderBytes) {
      throw new InputError("FILE_TOO_LARGE", "Folder exceeds the total size limit");
    }

    return {
      type: "folder",
      name: typeof descriptor["name"] === "string" ? descriptor["name"] : undefined,
      files: folderFiles,
    };
  }

  return descriptor as RawInput;
}

async function parseMultipart(request: Request): Promise<RawInput[]> {
  const form = await request.formData().catch(() => {
    throw new InputError("INVALID_INPUT", "Invalid multipart request");
  });
  const fileValues = form.getAll("files");
  if (!fileValues.every(isFile)) {
    throw new InputError("INVALID_INPUT", "files must contain file values");
  }
  if (fileValues.length > DEFAULT_INPUT_LIMITS.maxFolderFiles) {
    throw new InputError("FILE_TOO_LARGE", "Too many uploaded files");
  }

  const files = fileValues as File[];
  const totalFileBytes = files.reduce((total, file) => total + file.size, 0);
  if (
    !Number.isSafeInteger(totalFileBytes) ||
    totalFileBytes > MAX_MULTIPART_BODY_BYTES
  ) {
    throw new InputError("FILE_TOO_LARGE", "Uploaded files exceed the request size limit");
  }

  const rawDescriptors = form.has("inputs")
    ? validateEnvelope({ inputs: parseJsonField(form.get("inputs"), "inputs") })
    : [];

  const claimed = new Set<number>();
  const inputs: RawInput[] = [];
  for (const descriptor of rawDescriptors) {
    if (!isRecord(descriptor)) {
      throw new InputError("INVALID_INPUT", "Each input must be an object");
    }
    inputs.push(
      await materializeMultipartDescriptor(
        descriptor as Record<string, unknown>,
        files,
        claimed,
      ),
    );
  }

  const unclaimedCount = files.reduce(
    (total, _file, index) => total + (claimed.has(index) ? 0 : 1),
    0,
  );
  if (rawDescriptors.length + unclaimedCount > DEFAULT_INPUT_LIMITS.maxBatchSize) {
    throw new InputError("INVALID_INPUT", "Too many inputs in one batch");
  }

  for (let index = 0; index < files.length; index += 1) {
    if (!claimed.has(index)) {
      claimed.add(index);
      inputs.push({ type: "upload", file: await fileToRawInput(files[index]) });
    }
  }

  if (inputs.length === 0) {
    throw new InputError("INVALID_INPUT", "At least one input is required");
  }

  return inputs;
}

export async function parseInputRequest(request: Request): Promise<RawInput[]> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  const declaredLength = contentLength !== null && Number.isFinite(contentLength) ? contentLength : 0;

  if (contentType.startsWith("multipart/form-data")) {
    if (declaredLength > MAX_MULTIPART_BODY_BYTES) {
      throw new InputError("FILE_TOO_LARGE", "Request body exceeds the size limit");
    }
    const body = await readRequestBody(
      request,
      MAX_MULTIPART_BODY_BYTES,
      "Request body exceeds the size limit",
    );
    return parseMultipart(requestWithBody(request, body));
  }

  if (!contentType.startsWith("application/json")) {
    throw new InputError("UNSUPPORTED_INPUT_TYPE", "Use application/json or multipart/form-data");
  }
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    throw new InputError("FILE_TOO_LARGE", "JSON request body exceeds the size limit");
  }

  const bodyBytes = await readRequestBody(
    request,
    MAX_JSON_BODY_BYTES,
    "JSON request body exceeds the size limit",
  );
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
  } catch {
    throw new InputError("INVALID_INPUT", "Request body must be valid JSON");
  }
  const descriptors = validateEnvelope(body);
  if (descriptors.some((descriptor) => descriptor["type"] === "upload" || descriptor["type"] === "folder")) {
    throw new InputError("INVALID_INPUT", "File inputs require multipart/form-data");
  }
  return descriptors as RawInput[];
}

function parseMetadata(value: string | null): JsonObject {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

function inferOrigin(source: Source, metadata: JsonObject): InputOrigin {
  if (["url", "upload", "folder", "repository", "clipboard"].includes(String(metadata["origin"]))) {
    return metadata["origin"] as InputOrigin;
  }
  if (["WEBSITE", "WEB_APP", "FIGMA"].includes(source.type)) {
    return "url";
  }
  if (["GITHUB", "GITLAB"].includes(source.type)) {
    return "repository";
  }
  if (source.type === "LOCAL_PROJECT") {
    return "folder";
  }
  if (source.type === "TEXT") {
    return "clipboard";
  }
  return "upload";
}

export function serializeSource(source: Source) {
  return { ...serializeInput(source), type: source.type };
}

export function serializeInput(source: Source) {
  const metadata = parseMetadata(source.metadata);
  const kind = SOURCE_TYPE_TO_INPUT_KIND[source.type];
  return {
    id: source.id,
    projectId: source.projectId,
    kind,
    name: source.name,
    origin: inferOrigin(source, metadata),
    uri: source.uri,
    status: SOURCE_STATUS_TO_PUBLIC[source.status],
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    contentHash: source.contentHash,
    metadata,
    error:
      source.errorCode === null
        ? null
        : {
            code: source.errorCode,
            message: source.errorMessage ?? "Input processing failed",
          },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

const INPUT_ERROR_STATUS: Record<string, number> = {
  INVALID_INPUT: 400,
  UNSUPPORTED_INPUT_TYPE: 415,
  INVALID_URL: 400,
  URL_BLOCKED: 400,
  URL_TIMEOUT: 504,
  URL_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  INVALID_FILE: 400,
  ARCHIVE_INVALID: 400,
  ARCHIVE_TOO_LARGE: 413,
  ARCHIVE_UNSAFE_PATH: 400,
  REPOSITORY_INVALID: 400,
  REPOSITORY_UNAVAILABLE: 502,
  DOCUMENT_PARSE_FAILED: 422,
  STORAGE_FAILED: 500,
  DUPLICATE_INPUT: 409,
  INPUT_NOT_FOUND: 404,
};

export function wrapInputHttpError(error: unknown): Response {
  if (error instanceof InputError) {
    return jsonError(INPUT_ERROR_STATUS[error.code] ?? 400, error.code, {
      message: error.message,
    });
  }
  if (error instanceof HttpError) {
    return wrapHttpError(error);
  }
  return wrapHttpError(error, 500);
}
