export type ImageGenerationRequest = {
  prompt: string;

  width: number;
  height: number;

  style?: string;

  referenceAssetIds?: string[];
};

export type ImageGenerationResult = {
  uri: string;

  metadata?: Record<string, unknown>;
};

export interface ImageProvider {
  generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;
}