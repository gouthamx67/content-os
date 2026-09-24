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

export type Source = {
  id: string;
  projectId: string;
  type: SourceType;
  name: string;
  uri: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
};