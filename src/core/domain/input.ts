import type { Source, SourceStatus, SourceType } from "./source";

export const INPUT_KINDS = [
  "website",
  "web_app",
  "github",
  "gitlab",
  "local_project",
  "zip",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "figma",
  "text",
] as const;

export type InputKind = (typeof INPUT_KINDS)[number];
export type InputOrigin = "url" | "upload" | "folder" | "repository" | "clipboard";
export type PublicInputStatus = "queued" | "processing" | "ready" | "failed";
export type UploadInputKind = Exclude<
  InputKind,
  "website" | "web_app" | "github" | "gitlab" | "local_project"
>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface InputLimits {
  maxBatchSize: number;
  maxFileBytes: number;
  maxFolderBytes: number;
  maxFolderFiles: number;
  maxTextBytes: number;
  maxUrlBytes: number;
  maxRepositoryBytes: number;
  maxArchiveBytes: number;
  maxArchiveEntries: number;
  maxArchiveEntryBytes: number;
  maxArchiveExpandedBytes: number;
  maxRedirects: number;
  requestTimeoutMs: number;
}

export const DEFAULT_INPUT_LIMITS: InputLimits = Object.freeze({
  maxBatchSize: 20,
  maxFileBytes: 50 * 1024 * 1024,
  maxFolderBytes: 100 * 1024 * 1024,
  maxFolderFiles: 1_000,
  maxTextBytes: 5 * 1024 * 1024,
  maxUrlBytes: 25 * 1024 * 1024,
  maxRepositoryBytes: 100 * 1024 * 1024,
  maxArchiveBytes: 100 * 1024 * 1024,
  maxArchiveEntries: 10_000,
  maxArchiveEntryBytes: 25 * 1024 * 1024,
  maxArchiveExpandedBytes: 500 * 1024 * 1024,
  maxRedirects: 3,
  requestTimeoutMs: 15_000,
});

export const INPUT_ERROR_CODES = [
  "INVALID_INPUT",
  "UNSUPPORTED_INPUT_TYPE",
  "INVALID_URL",
  "URL_BLOCKED",
  "URL_TIMEOUT",
  "URL_TOO_LARGE",
  "FILE_TOO_LARGE",
  "INVALID_FILE",
  "ARCHIVE_INVALID",
  "ARCHIVE_TOO_LARGE",
  "ARCHIVE_UNSAFE_PATH",
  "REPOSITORY_INVALID",
  "REPOSITORY_UNAVAILABLE",
  "DOCUMENT_PARSE_FAILED",
  "STORAGE_FAILED",
  "DUPLICATE_INPUT",
  "INPUT_NOT_FOUND",
] as const;

export type InputErrorCode = (typeof INPUT_ERROR_CODES)[number];

export class InputError extends Error {
  override readonly name = "InputError";

  constructor(
    readonly code: InputErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface NormalizedInputFile {
  name: string;
  relativePath?: string;
  mimeType: string;
  bytes: Uint8Array;
  lastModified?: number;
}

export type NormalizedInput =
  | {
      origin: "url";
      kind: "website" | "web_app" | "figma";
      value: string;
      name: string;
    }
  | {
      origin: "repository";
      kind: "github" | "gitlab";
      value: string;
      name: string;
    }
  | {
      origin: "clipboard";
      kind: "text";
      value: string;
      name: string;
    }
  | {
      origin: "upload";
      kind: UploadInputKind;
      name: string;
      file: NormalizedInputFile;
    }
  | {
      origin: "folder";
      kind: "local_project";
      name: string;
      files: readonly NormalizedInputFile[];
    };

export interface InputBundle {
  projectId: string;
  inputs: Source[];
  versions: Array<{
    contentHash: string;
    sourceIds: string[];
  }>;
  unversioned: Source[];
}

export const INPUT_KIND_TO_SOURCE_TYPE: Readonly<Record<InputKind, SourceType>> = Object.freeze({
  website: "WEBSITE",
  web_app: "WEB_APP",
  github: "GITHUB",
  gitlab: "GITLAB",
  local_project: "LOCAL_PROJECT",
  zip: "ZIP",
  document: "DOCUMENT",
  pdf: "PDF",
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  figma: "FIGMA",
  text: "TEXT",
});

export const SOURCE_TYPE_TO_INPUT_KIND: Readonly<Record<SourceType, InputKind | "other">> = Object.freeze({
  WEBSITE: "website",
  WEB_APP: "web_app",
  GITHUB: "github",
  GITLAB: "gitlab",
  LOCAL_PROJECT: "local_project",
  ZIP: "zip",
  DOCUMENT: "document",
  PDF: "pdf",
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  FIGMA: "figma",
  TEXT: "text",
  OTHER: "other",
});

export const SOURCE_STATUS_TO_PUBLIC: Readonly<Record<SourceStatus, PublicInputStatus>> = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
});
