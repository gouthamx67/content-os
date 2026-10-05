/**
 * The engine's budget, checked before anything expensive happens.
 *
 * These are the numbers that keep one request from becoming an unbounded render,
 * an unbounded queue or an unbounded image. They live in one place so the API,
 * the batch creator and the worker enforce exactly the same ceiling.
 */
export const ADAPTATION_LIMITS = {
  /** Targets per batch. Beyond this a request is a campaign, which is CP23. */
  maxTargetsPerBatch: 16,
  /** Copy longer than this is a document, not a post. */
  maxCopyCharacters: 4_000,
  /** Pixel budget for one output image (16 MP). */
  maxImagePixels: 16_000_000,
  /** A queued job older than this is abandoned rather than run. */
  maxQueueAgeMs: 24 * 60 * 60 * 1_000,
  /** Guards the JSON snapshot and recipe columns. */
  maxSnapshotCharacters: 2_000_000,
  /** Pixels a source image may have before it can be adapted at all. */
  maxSourceImagePixels: 16_000_000,
} as const;

export type ResolvedPlatform = {
  id: string;
  name: string;
  channels: readonly string[];
  defaultAspectRatio: string | null;
};