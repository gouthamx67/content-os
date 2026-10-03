import type {
  GraphicTemplateType,
  ImageGenerationJobStatus,
  ImageGenerationProvider,
  ImageOutputFormat,
} from "../domain/types";

/** The job shape the image APIs return. Mirrors `imageGenerationJobView`. */
export type ImageJobView = {
  id: string;
  projectId: string;
  graphicDocumentId: string | null;
  provider: ImageGenerationProvider;
  status: ImageGenerationJobStatus;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  transparent: boolean;
  prompt: string;
  recipeSha256: string;
  progressPct: number;
  providerVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

/** The asset shape the image APIs return. Mirrors `generatedImageAssetView`. */
export type GeneratedAssetView = {
  id: string;
  projectId: string;
  generationJobId: string | null;
  graphicDocumentId: string | null;
  mimeType: string;
  outputFormat: ImageOutputFormat;
  width: number;
  height: number;
  byteSize: number;
  checksumSha256: string;
  transparent: boolean;
  metadata: unknown;
  createdAt: string;
  streamUrl: string;
};

export type GraphicDocumentView = {
  id: string;
  projectId: string;
  name: string;
  templateType: GraphicTemplateType;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  designGraph: unknown;
  designGraphHash: string;
  contractVersion: number;
  createdAt: string;
  updatedAt: string;
};
