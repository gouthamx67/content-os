import { createHash } from "node:crypto";
import type { RendererContract } from "../../visual-motion-engine/export/renderer-contract";
import { stableStringify } from "./stable-json";

/**
 * A content hash of the exact scene a render job will render.
 *
 * It is stored on the job so two renders can be compared without diffing JSON,
 * and so a later reader can tell whether the composition changed between the
 * enqueue and the artifact. The whole contract is hashed — canvas, layers,
 * keyframes, effects — not just an id.
 */
export function hashScene(contract: RendererContract): string {
  return createHash("sha256").update(stableStringify(contract)).digest("hex");
}
