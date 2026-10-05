export type WritingJobView = {
  id: string;
  projectId: string;
  documentId: string | null;
  provider: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCEL_REQUESTED"
    | "CANCELLED";
  blockType: string;
  tone: string;
  length: string;
  objective: string;
  audience: string | null;
  language: string | null;
  prompt: string;
  recipeSha256: string;
  contextSha256: string;
  variantCount: number;
  progressPct: number;
  providerModel: string | null;
  providerVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type WritingVariantView = {
  id: string;
  documentId: string;
  ordinal: number;
  label: string;
  text: string;
  textSha256: string;
  instruction: string | null;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WritingClaimView = {
  id: string;
  projectId: string;
  documentId: string;
  variantId: string | null;
  text: string;
  status: "GROUNDED" | "UNSUPPORTED" | "REVIEW";
  sourceIds: string[];
  reasoning: string | null;
  createdAt: string;
};

export type WritingDocumentView = {
  id: string;
  projectId: string;
  title: string;
  blockType: string;
  tone: string;
  length: string;
  objective: string;
  audience: string | null;
  language: string | null;
  content: string;
  contentSha256: string;
  contextSha256: string;
  version: number;
  brandVersion: number | null;
  intelligenceVersion: number | null;
  intentId: string | null;
  directionId: string | null;
  storyboardId: string | null;
  sceneId: string | null;
  selectedVariantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WritingDocumentDetail = {
  document: WritingDocumentView;
  variants: WritingVariantView[];
  claims: WritingClaimView[];
};
