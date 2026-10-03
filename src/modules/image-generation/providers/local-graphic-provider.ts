import { renderSvg } from "../render/svg-renderer";
import { rasterizeSvg } from "../render/rasterize";
import type {
  ImageProviderAdapter,
  ProviderGenerationInput,
  ProviderGenerationResult,
} from "./provider";

export const LOCAL_GRAPHIC_PROVIDER_VERSION = "local-graphic/1";

/**
 * The real, deterministic renderer. It draws the design graph to SVG and hands
 * the SVG to Sharp; there is no placeholder path and no branch that returns
 * success without bytes.
 */
export async function generateLocalGraphic(
  input: ProviderGenerationInput,
): Promise<ProviderGenerationResult> {
  const svg = renderSvg(input.graph, input.imageDataUrls);
  const raster = await rasterizeSvg({
    svg,
    width: input.width,
    height: input.height,
    format: input.format,
    transparent: input.transparent,
  });

  return {
    bytes: raster.bytes,
    width: raster.width,
    height: raster.height,
    mimeType: raster.mimeType,
    format: raster.format,
    providerJobId: null,
    providerModel: null,
    providerVersion: LOCAL_GRAPHIC_PROVIDER_VERSION,
  };
}

export const localGraphicProvider: ImageProviderAdapter = {
  provider: "LOCAL_GRAPHIC",
  version: LOCAL_GRAPHIC_PROVIDER_VERSION,
  generate: generateLocalGraphic,
};
