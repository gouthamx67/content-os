import type { ImageOutputFormat } from "./domain/types";

export type ImageVariantSpec = {
  key: string;
  label: string;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  transparent: boolean;
  /** Folded into the prompt so each variant's recipe hash differs. */
  promptSuffix: string;
};

/** The four platform shapes a single brief is normally asked to fill. */
export const DEFAULT_IMAGE_VARIANTS: readonly ImageVariantSpec[] = [
  {
    key: "SQUARE",
    label: "Square",
    width: 1080,
    height: 1080,
    outputFormat: "PNG",
    transparent: false,
    promptSuffix: "Square social crop",
  },
  {
    key: "PORTRAIT",
    label: "Portrait",
    width: 1080,
    height: 1350,
    outputFormat: "PNG",
    transparent: false,
    promptSuffix: "Portrait social crop",
  },
  {
    key: "LANDSCAPE",
    label: "Landscape",
    width: 1600,
    height: 900,
    outputFormat: "PNG",
    transparent: false,
    promptSuffix: "Landscape banner crop",
  },
  {
    key: "TRANSPARENT",
    label: "Transparent",
    width: 1600,
    height: 1600,
    outputFormat: "PNG",
    transparent: true,
    promptSuffix: "Transparent cutout",
  },
];
