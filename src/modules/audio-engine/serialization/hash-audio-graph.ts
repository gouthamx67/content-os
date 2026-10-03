import { createHash } from "node:crypto";
import { stableStringify } from "../../video-rendering/serialization/stable-json";
import type { AudioGraph } from "./audio-graph";

/**
 * A content hash of the exact audio timeline a render job will mix.
 *
 * The deterministic serialiser is the one CP15 already uses, so two graphs that
 * differ only in key insertion order hash the same. Stored on the job so two
 * renders can be compared without diffing JSON.
 */
export function hashAudioGraph(graph: AudioGraph): string {
  return createHash("sha256").update(stableStringify(graph)).digest("hex");
}
