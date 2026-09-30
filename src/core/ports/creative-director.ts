/**
 * A creative director is a proposal machine, not a writer of record. It receives
 * the whole context and returns drafts: the creative text and nothing else.
 *
 * Deliberately absent from `CreativeDirectionDraft`: `id`, `projectId`,
 * `strengthScore`, `brandVersion`, `intelligenceVersion`, `status` and
 * `editedByUser`. The service assigns those, so a provider - or a model behind a
 * provider - cannot mint a row, claim a provenance it was not given, or mark its
 * own output as user-edited.
 */

import type { CreativeContext } from "../domain/creative-context";
import type {
  CreativeAngle,
  CreativeDirectionDraft,
} from "../domain/creative-direction";

export interface CreativeDirectorRequest {
  context: CreativeContext;
  count: number;
  /** Angles to explore. Empty means the mode's own allowed set. */
  readonly angles: readonly CreativeAngle[];
}

export interface CreativeDirectionProposal {
  id: string;
  name: string;
  description: string;
  draft: CreativeDirectionDraft;
}

export interface CreativeDirectorResult {
  provider: string;
  model: string | null;
  proposals: CreativeDirectionProposal[];
}

export interface CreativeDirector {
  readonly id: string;
  generate(request: CreativeDirectorRequest): Promise<CreativeDirectorResult>;
}
