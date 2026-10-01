import type { AssetType } from "./asset";
import type { BrandExecutionProfile } from "./brand";

/**
 * Everything CP12 is allowed to reason about, resolved server-side from real
 * project data. The client never sends this: a caller that could name its own
 * features would be able to invent capabilities, so the shape is built from the
 * intelligence graph, the brand profile, the asset store and existing content,
 * and the API accepts a projectId instead.
 *
 * Timestamps are ISO strings rather than `Date` to match the rest of the domain,
 * and so a context serialises to JSON without a replacer.
 */

export type RecommendationProductData = {
  name: string;
  description: string | null;
  /** 0-100. Derived from the product's confidence, never asserted outright. */
  confidence: number;
  category: string | null;
  valueProposition: string | null;
  /**
   * Provenance of the product record itself.
   *
   * A recommendation about the product as a whole has no feature or workflow to
   * borrow provenance from, so without this it could only ever be served with no
   * sources at all — which would make the absence of provenance look like a
   * property of the recommendation rather than a gap in the plumbing.
   */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationFeatureData = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  importance: string;
  confidence: number;
  /** Ids of real Source documents this feature was extracted from. */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationWorkflowData = {
  id: string;
  name: string;
  description: string | null;
  /** Ordered action names, so a workflow can be recommended without inventing steps. */
  steps: string[];
  featureIds: string[];
  confidence: number;
  /** Ids of real Source documents this workflow was extracted from. */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationProblemData = {
  id: string;
  name: string;
  description: string | null;
  confidence: number;
  /** Ids of real Source documents this problem was extracted from. */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationBenefitData = {
  id: string;
  name: string;
  description: string | null;
  confidence: number;
  /** Ids of real Source documents this benefit was extracted from. */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationClaimData = {
  id: string;
  text: string;
  claimType: string;
  verification: string;
  confidence: number;
  /** Ids of real Source documents this claim was extracted from. */
  sourceIds: string[];
  evidenceIds: string[];
};

export type RecommendationAssetData = {
  id: string;
  name: string;
  type: AssetType;
  /** Role the asset could play, derived from its type; may be null when unclear. */
  role: string | null;
};

export type RecommendationAudienceData = {
  id: string;
  segment: string;
  description: string | null;
  confidence: number;
};

export type RecommendationExistingContent = {
  id: string;
  contentTypeId: string;
  platformIds: string[];
  /** CP09 subject entity ids this content is about, never source document ids. */
  subjectIds: string[];
  createdAt: string;
};

export type RecommendationContext = {
  projectId: string;
  product: RecommendationProductData | null;
  brand: BrandExecutionProfile | null;
  features: RecommendationFeatureData[];
  workflows: RecommendationWorkflowData[];
  problems: RecommendationProblemData[];
  benefits: RecommendationBenefitData[];
  claims: RecommendationClaimData[];
  assets: RecommendationAssetData[];
  audienceSignals: RecommendationAudienceData[];
  /** Content already planned or produced, so gaps mean something. */
  existingContent: RecommendationExistingContent[];

  /**
   * Channels the project has already used, derived from existing content and
   * asset types. Drives channel-diverse selection: the second product demo is
   * less useful than a carousel for the same feature.
   */
  channelsUsed: string[];

  /**
   * Platforms this project can plausibly publish to, taken from the CP09
   * platform registry filtered by what the project has evidence for. A platform
   * the project has never signalled interest in is not treated as available, and
   * this is derived rather than hardcoded so it can move later.
   */
  availablePlatforms: string[];

  /**
   * Per-platform ranking weight. Platforms with no entry fall back to a neutral
   * weight instead of an invented preference.
   */
  platformPriority: Record<string, number>;
};

export function emptyRecommendationContext(projectId: string): RecommendationContext {
  return {
    projectId,
    product: null,
    brand: null,
    features: [],
    workflows: [],
    problems: [],
    benefits: [],
    claims: [],
    assets: [],
    audienceSignals: [],
    existingContent: [],
    channelsUsed: [],
    availablePlatforms: [],
    platformPriority: {},
  };
}
