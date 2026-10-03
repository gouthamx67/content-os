import type {
  GraphicDesignGraph,
  ImageGenerationProvider,
  ImageOutputFormat,
} from "../domain/types";

export type ProviderGenerationInput = {
  graph: GraphicDesignGraph;
  width: number;
  height: number;
  format: ImageOutputFormat;
  transparent: boolean;
  /** Image element id -> data URL, resolved before the provider is called. */
  imageDataUrls: ReadonlyMap<string, string>;
};

export type ProviderGenerationResult = {
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: string;
  format: ImageOutputFormat;
  providerJobId: string | null;
  providerModel: string | null;
  providerVersion: string | null;
};

/**
 * The provider boundary. Everything above it deals in a design graph and a
 * resolution; everything below it deals in bytes. A future external model slots
 * in here without the service, worker or API learning a new shape.
 */
export interface ImageProviderAdapter {
  readonly provider: ImageGenerationProvider;
  readonly version: string;
  generate(input: ProviderGenerationInput): Promise<ProviderGenerationResult>;
}
