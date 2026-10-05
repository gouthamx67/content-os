import {
  isWritingBlockType,
  isWritingLength,
  isWritingTone,
} from "./block-rules";
import { isWritingObjective } from "./objectives";
import {
  WRITING_PROVIDERS,
  type WritingGenerateRequest,
  type WritingProvider,
} from "./types";
import { WritingError } from "../errors";

export const MIN_VARIANTS = 1;
export const MAX_VARIANTS = 5;

export function isWritingProvider(value: unknown): value is WritingProvider {
  return (
    typeof value === "string" &&
    (WRITING_PROVIDERS as readonly string[]).includes(value)
  );
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WritingError("WRITING_INVALID_INPUT", `${field} is required`);
  }
  return value.trim();
}

/**
 * Validates a generation request before anything is enqueued.
 *
 * The unions are checked here rather than trusted from the client, so an unknown
 * block type or tone is a typed 400 instead of a database check violation.
 */
export function validateGenerateRequest(
  input: Partial<WritingGenerateRequest> & Record<string, unknown>,
): asserts input is WritingGenerateRequest {
  requireText(input["projectId"], "projectId");
  requireText(input["requestedById"], "requestedById");
  requireText(input["prompt"], "prompt");

  if (!isWritingBlockType(input["blockType"])) {
    throw new WritingError(
      "WRITING_UNSUPPORTED_BLOCK_TYPE",
      `Unsupported block type: ${String(input["blockType"])}`,
    );
  }
  if (!isWritingTone(input["tone"])) {
    throw new WritingError(
      "WRITING_UNSUPPORTED_TONE",
      `Unsupported tone: ${String(input["tone"])}`,
    );
  }
  if (!isWritingLength(input["length"])) {
    throw new WritingError(
      "WRITING_UNSUPPORTED_LENGTH",
      `Unsupported length: ${String(input["length"])}`,
    );
  }
  if (!isWritingObjective(input["objective"])) {
    throw new WritingError(
      "WRITING_UNSUPPORTED_OBJECTIVE",
      `Unsupported objective: ${String(input["objective"])}`,
    );
  }
  if (!isWritingProvider(input["provider"])) {
    throw new WritingError(
      "WRITING_INVALID_INPUT",
      `Unsupported provider: ${String(input["provider"])}`,
    );
  }

  const variantCount = input["variantCount"];
  if (
    typeof variantCount !== "number" ||
    !Number.isInteger(variantCount) ||
    variantCount < MIN_VARIANTS ||
    variantCount > MAX_VARIANTS
  ) {
    throw new WritingError(
      "WRITING_INVALID_INPUT",
      `variantCount must be an integer between ${MIN_VARIANTS} and ${MAX_VARIANTS}`,
    );
  }

  const language = input["language"];
  if (
    language !== null &&
    language !== undefined &&
    (typeof language !== "string" || language.trim().length === 0)
  ) {
    throw new WritingError("WRITING_INVALID_INPUT", "language must be a non-empty code");
  }
}
