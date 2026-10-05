import type {
  AdaptationKind,
  AdaptationSourceType,
  FormatContract,
} from "../domain/types";
import { AdaptationError } from "../errors";
import { requireFormatContract } from "./registry";

/**
 * Which source can become which output.
 *
 * The rule is one-way and deliberately blunt: copy is trimmed, an image is
 * re-cropped, a composition is re-rendered. Nothing is translated, nothing is
 * invented, and no source type ever produces a kind its canonical owner does
 * not already hold.
 */
const SOURCE_KIND: Readonly<Record<AdaptationSourceType, AdaptationKind>> = {
  WRITING_VARIANT: "COPY",
  GENERATED_IMAGE: "IMAGE",
  VISUAL_COMPOSITION: "VIDEO",
};

export function kindForSource(
  sourceType: AdaptationSourceType,
): AdaptationKind {
  return SOURCE_KIND[sourceType];
}

export function isCompatibleFormat(
  sourceType: AdaptationSourceType,
  format: FormatContract,
): boolean {
  return SOURCE_KIND[sourceType] === format.kind;
}

/**
 * Resolves one requested target into a format contract, refusing a format that
 * could never be produced from this source.
 *
 * The refusal happens here rather than in the worker so an impossible batch is
 * never created in the first place.
 */
export function resolveTargetFormat(args: {
  sourceType: AdaptationSourceType;
  formatId: string;
}): FormatContract {
  const format = requireFormatContract(args.formatId);

  if (!isCompatibleFormat(args.sourceType, format)) {
    throw new AdaptationError(
      "ADAPTATION_FORMAT_KIND_MISMATCH",
      `${format.id} produces ${format.kind}, which a ${args.sourceType} cannot become`,
      422,
    );
  }

  return format;
}