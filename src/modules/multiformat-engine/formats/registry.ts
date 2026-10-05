import type { AdaptationKind, FormatContract } from "../domain/types";
import { AdaptationError } from "../errors";

/**
 * Every output shape CP19 can produce, in one table.
 *
 * The registry is the only place a dimension is written down. The API, the
 * recipe builder and the worker all read it, so a canvas can never be defined
 * twice with two different values — and a client can never send its own width.
 *
 * Copy limits are ceilings, not targets: `fitCopy` shortens to fit them, it does
 * not stretch to fill them.
 */
export const FORMAT_CONTRACTS: readonly FormatContract[] = [
  {
    id: "IMAGE_SQUARE",
    label: "Square image",
    kind: "IMAGE",
    image: {
      mimeType: "image/png",
      extension: "png",
      width: 1080,
      height: 1080,
      fit: "COVER",
      position: "center",
      alpha: false,
    },
  },
  {
    id: "IMAGE_PORTRAIT",
    label: "Portrait image",
    kind: "IMAGE",
    image: {
      mimeType: "image/png",
      extension: "png",
      width: 1080,
      height: 1350,
      fit: "COVER",
      position: "center",
      alpha: false,
    },
  },
  {
    id: "IMAGE_VERTICAL",
    label: "Vertical image",
    kind: "IMAGE",
    image: {
      mimeType: "image/png",
      extension: "png",
      width: 1080,
      height: 1920,
      fit: "COVER",
      position: "center",
      alpha: false,
    },
  },
  {
    id: "IMAGE_LANDSCAPE",
    label: "Landscape image",
    kind: "IMAGE",
    image: {
      mimeType: "image/png",
      extension: "png",
      width: 1600,
      height: 900,
      fit: "COVER",
      position: "center",
      alpha: false,
    },
  },
  {
    id: "IMAGE_TRANSPARENT",
    label: "Transparent image",
    kind: "IMAGE",
    image: {
      mimeType: "image/png",
      extension: "png",
      width: 1600,
      height: 1600,
      fit: "CONTAIN",
      position: "center",
      alpha: true,
    },
  },
  {
    id: "COPY_SHORT",
    label: "Short caption",
    kind: "COPY",
    copy: { maxCharacters: 80, maxWords: 14 },
  },
  {
    id: "COPY_MEDIUM",
    label: "Medium caption",
    kind: "COPY",
    copy: { maxCharacters: 300, maxWords: 55 },
  },
  {
    id: "COPY_CAPTION",
    label: "Long caption",
    kind: "COPY",
    copy: { maxCharacters: 2_200, maxWords: 350 },
  },
  {
    id: "COPY_LONG",
    label: "Long-form text",
    kind: "COPY",
    copy: { maxCharacters: 4_000, maxWords: 650 },
  },
  {
    id: "VIDEO_SQUARE",
    label: "Square video",
    kind: "VIDEO",
    video: { width: 1080, height: 1080 },
  },
  {
    id: "VIDEO_VERTICAL",
    label: "Vertical video",
    kind: "VIDEO",
    video: { width: 1080, height: 1920 },
  },
  {
    id: "VIDEO_LANDSCAPE",
    label: "Landscape video",
    kind: "VIDEO",
    video: { width: 1920, height: 1080 },
  },
];

const BY_ID = new Map(FORMAT_CONTRACTS.map((format) => [format.id, format]));

/**
 * Looks a format up by id.
 *
 * An unknown id is a 404, not a silent fallback: a client that asked for a
 * shape CP19 does not have must be told so rather than handed a different one.
 */
export function getFormatContract(id: string): FormatContract | null {
  return BY_ID.get(id) ?? null;
}

export function requireFormatContract(id: string): FormatContract {
  const format = getFormatContract(id);
  if (!format) {
    throw new AdaptationError(
      "ADAPTATION_FORMAT_UNKNOWN",
      `Unknown format: ${id}`,
      404,
    );
  }
  return format;
}

export function listFormatContracts(kind?: AdaptationKind): FormatContract[] {
  return kind
    ? FORMAT_CONTRACTS.filter((format) => format.kind === kind)
    : [...FORMAT_CONTRACTS];
}