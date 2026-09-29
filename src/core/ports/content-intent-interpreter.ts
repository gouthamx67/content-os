import type { AspectRatio } from "../domain/content-intent";

/**
 * The interpreter answers exactly one question: what did the user ask for? It
 * is not a creative director and the shape says so. There is no field for a
 * hook, a story, an angle, a scene list, an audience persona or a call to
 * action, so a model has nowhere to put the ideas that belong to CP10 and CP12 -
 * a response carrying one is rejected rather than quietly trimmed.
 */
export interface ContentIntentInterpretationRequest {
  projectId: string;
  rawRequest: string;

  /**
   * The registries, not free text descriptions of them. A model can only return
   * an id that exists here, and the validator checks it again on the way back in.
   */
  contentTypes: ReadonlyArray<{
    id: string;
    name: string;
    description: string;
    channel: string;
    supportedPlatforms: readonly string[];
  }>;

  platforms: ReadonlyArray<{
    id: string;
    name: string;
    channels: readonly string[];
  }>;

  projectContext?: string;
  brandContext?: string;
  intelligenceSummary?: string;

  model?: string;
}

export interface ContentIntentInterpretation {
  provider: string;
  model: string;

  contentTypeId?: string;
  purpose?: string;
  platforms: string[];
  durationSeconds?: number;
  aspectRatio?: AspectRatio;
  language?: string;
  tone?: string;
  style?: string;
  quantity?: number;

  notes: string[];
}

export interface ContentIntentInterpretationProvider {
  readonly id: string;
  interpret(
    request: ContentIntentInterpretationRequest,
  ): Promise<ContentIntentInterpretation>;
}
