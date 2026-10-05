import type { SnapshotClaim } from "../../domain/types";
import { AdaptationError } from "../../errors";
import { countWords, normalizeWhitespace } from "./fit-copy";

export type ValidateCopyOutputArgs = {
  outputText: string;
  sourceText: string;
  maxCharacters: number;
  maxWords: number;
};

export type CopyOutputFacts = {
  characterCount: number;
  wordCount: number;
  truncated: boolean;
};

/**
 * Checks an adapted caption before it is allowed to be called a variant.
 *
 * Two properties matter more than the length itself. It must be within the
 * format's ceiling, and it must be a *prefix* of the source: fitting only ever
 * removes, so anything else means something invented text on the way through.
 */
export function validateCopyOutput(args: ValidateCopyOutputArgs): CopyOutputFacts {
  const output = normalizeWhitespace(args.outputText);
  const source = normalizeWhitespace(args.sourceText);

  if (output.length > args.maxCharacters) {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      `Adapted copy is ${output.length} characters, over the ${args.maxCharacters} limit`,
      500,
    );
  }

  const wordCount = countWords(output);
  if (wordCount > args.maxWords) {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      `Adapted copy is ${wordCount} words, over the ${args.maxWords} limit`,
      500,
    );
  }

  if (!source.startsWith(output)) {
    throw new AdaptationError(
      "ADAPTATION_OUTPUT_INVALID",
      "Adapted copy is not a prefix of the source text",
      500,
    );
  }

  return {
    characterCount: output.length,
    wordCount,
    truncated: output.length < source.length,
  };
}

/**
 * Which claims, and whose provenance, survive the cut.
 *
 * A claim counts as surviving only when its exact text is still in the output —
 * no fuzzy matching, because a claim that no longer reads the same is no longer
 * supported by the same evidence. Provenance is then carried only by claims the
 * CP18 engine marked `GROUNDED`: an `UNSUPPORTED` or `REVIEW` claim is still
 * shown, but it must not be exported as a source that backs the text.
 */
export function survivingClaims(args: {
  outputText: string;
  claims: readonly SnapshotClaim[];
}): { claims: SnapshotClaim[]; sourceIds: string[] } {
  const output = normalizeWhitespace(args.outputText);

  const kept = args.claims.filter((claim) =>
    output.includes(normalizeWhitespace(claim.text)),
  );

  const sourceIds: string[] = [];
  for (const claim of kept) {
    if (claim.status !== "GROUNDED") continue;
    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.includes(sourceId)) sourceIds.push(sourceId);
    }
  }

  return { claims: kept, sourceIds };
}