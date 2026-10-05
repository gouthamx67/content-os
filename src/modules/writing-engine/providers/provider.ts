import type {
  WritingCandidate,
  WritingContext,
  WritingProvider,
} from "../domain/types";

export type WritingProviderRequest = {
  context: WritingContext;
  variantCount: number;
};

export type WritingProviderResult = {
  candidates: WritingCandidate[];
  providerModel: string | null;
  providerVersion: string | null;
};

export type WritingProviderId = WritingProvider;

/**
 * A writing provider turns a frozen context into candidate copy. It never sees
 * the database and never validates itself: grounding is the engine's job, so a
 * provider that invents a claim produces a candidate the validator will reject
 * rather than one that slips through.
 */
export interface WritingTextProvider {
  readonly id: WritingProviderId;
  generate(request: WritingProviderRequest): Promise<WritingProviderResult>;
}
