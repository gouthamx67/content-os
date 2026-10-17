import { createHash } from "node:crypto";
import { stableStringify } from "../video-rendering/serialization/stable-json";
import type { PublishableSnapshot } from "./domain/types";

/**
 * The digest of a publishable snapshot is a property of its fields, not of the
 * order they were assembled. Sorting keys first keeps the hash reproducible
 * across processes so a worker can detect a changed source before dispatch.
 */
export function hashPublishableSnapshot(input: {
  title: string;
  content: string;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        title: input.title,
        content: input.content,
      }),
    )
    .digest("hex");
}

export function buildPublishableSnapshot(input: {
  title: string;
  content: string;
  sourceLabel: string;
  approvalNote: string | null;
}): PublishableSnapshot {
  return {
    title: input.title,
    content: input.content,
    contentSha256: hashPublishableSnapshot(input),
    sourceLabel: input.sourceLabel,
    approvalNote: input.approvalNote,
  };
}

const METADATA_STRING_LIMIT = 500;

/**
 * Attempt metadata is persisted evidence, so it must stay small and free of
 * anything that looks like a secret. Provider payloads never land here: only
 * bounded scalars the provider boundary already classified.
 */
export function boundedAttemptMetadata(
  input: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (input === null) return null;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
      continue;
    }
    if (typeof value === "string") {
      output[key] =
        value.length > METADATA_STRING_LIMIT
          ? `${value.slice(0, METADATA_STRING_LIMIT)}…`
          : value;
    }
  }
  return output;
}
