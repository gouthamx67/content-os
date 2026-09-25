export type SourceType =
  | "WEBSITE"
  | "WEB_APP"
  | "GITHUB"
  | "GITLAB"
  | "LOCAL_PROJECT"
  | "ZIP"
  | "DOCUMENT"
  | "PDF"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "FIGMA"
  | "TEXT"
  | "OTHER";

export type SourceStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export type Source = {
  id: string;
  projectId: string;
  type: SourceType;
  name: string;
  uri: string | null;
  metadata: string | null;
  status: SourceStatus;
  mimeType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  storageKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};