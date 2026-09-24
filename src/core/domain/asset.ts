export type AssetType =
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "DOCUMENT"
  | "LOGO"
  | "SCREENSHOT"
  | "UI_CAPTURE"
  | "OTHER";

export type Asset = {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  uri: string;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
};