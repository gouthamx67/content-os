import { getContentType } from "../domain/content-type";
import { getPlatform } from "../domain/platform";
import type { OpportunityChannel } from "../domain/content-opportunity";
import type {
  RecommendationAssetData,
  RecommendationAudienceData,
  RecommendationContext,
} from "../domain/recommendation-context";
import {
  timesCovered,
  type ContentHistory,
} from "./content-history-analyzer";
import type { ContentGap } from "./content-gap-detector";

/**
 * Ranking is a transparent sum of named factors, never a single opaque number.
 * Two reasons this matters beyond tidiness: the service only ever shows reasons
 * to a user, so an unexplained score would be unshowable; and a model-assisted
 * refinement has to be checked against the deterministic result, which is only
 * possible if the contribution of each factor is separable.
 *
 * Weights sum to 1 so a total is readable as "this much of the score came from
 * evidence". Factor values are 0-100 and are clamped, never trusted from input.
 *
 * Every factor here either varies between candidates drawn from the same project
 * or is documented as carrying no signal. A factor that is the same number for
 * every candidate does not rank anything, and presenting it as if it did would
 * make the score look more considered than it is. That is why coverage is read
 * from the shared history rather than recomputed, why gap detection is read from
 * the one shared detector rather than decided here a second time, why platform
 * fit reads real project usage plus the registry's own ordering, and why asset
 * availability is weighted by the channel that would consume the assets. `audienceFit` is the
 * one factor that can legitimately be flat, and it scores low rather than high
 * when the project has no audience signals.
 */

export type ScoreFactorName =
  | "subjectEvidence"
  | "featureCoverage"
  | "contentGap"
  | "audienceFit"
  | "assetAvailability"
  | "platformFit";

export type ScoreFactor = {
  name: ScoreFactorName;
  /** 0-100 before weighting. */
  value: number;
  weight: number;
  /** Human-readable explanation, shown to the user. */
  reason: string;
};

export const SCORE_WEIGHTS: Record<ScoreFactorName, number> = {
  subjectEvidence: 0.3,
  contentGap: 0.22,
  featureCoverage: 0.2,
  platformFit: 0.13,
  audienceFit: 0.1,
  assetAvailability: 0.05,
};

const CONFIDENCE_SCORE: Record<string, number> = {
  HIGH: 100,
  MEDIUM: 65,
  LOW: 35,
};

const IMPORTANCE_SCORE: Record<string, number> = {
  PRIMARY: 100,
  SECONDARY: 65,
  TERTIARY: 35,
};

/**
 * How much a channel can actually use an existing asset. Visual channels consume
 * assets directly; a text post barely does, so having twenty images should not
 * make a LinkedIn post the strongest suggestion in the list.
 */
const ASSET_CHANNEL_WEIGHT: Record<OpportunityChannel, number> = {
  IMAGE: 1.15,
  VIDEO: 1.1,
  CAMPAIGN: 0.8,
  AUDIO: 0.5,
  TEXT: 0.4,
};

export function parseFactor(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? clamp(value) : 0;
  }
  const upper = value.trim().toUpperCase();
  if (CONFIDENCE_SCORE[upper] !== undefined) return CONFIDENCE_SCORE[upper];
  if (IMPORTANCE_SCORE[upper] !== undefined) return IMPORTANCE_SCORE[upper];
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : clamp(parsed);
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * How much of a gap this content type represents.
 *
 * Whether something is a gap is decided by the shared detector and passed in,
 * rather than being re-derived here. That matters because the detector knows two
 * things this function cannot: that a format the project already uses is not a
 * gap, and that a format it could not publish to any supported platform is not a
 * gap either. Re-deriving the first rule locally is how "covered" quietly came
 * to mean two different things across the codebase.
 *
 * Absence from the gap list therefore means one of two different things, and the
 * history is what tells them apart: already covered, which is a smaller loss, or
 * unreachable, which is not a recommendation at all and scores lowest.
 */
export function contentGap(
  history: ContentHistory,
  gaps: ReadonlyMap<string, ContentGap>,
  contentTypeId: string,
): number {
  const detected = gaps.get(contentTypeId);
  if (detected) return clamp(detected.score);
  return history.coveredContentTypes.includes(contentTypeId) ? 20 : 0;
}

/**
 * How thinly this subject has been covered, so the tenth demo of a feature is not
 * suggested. Uncovered scores 100 and every existing item damps it, which means
 * the first suggestion is never suppressed.
 */
export function featureCoverage(
  history: ContentHistory,
  subjectId: string | null,
): number {
  return Math.max(0, 100 - timesCovered(history, subjectId) * 30);
}

export function audienceFit(
  audienceSignals: readonly RecommendationAudienceData[],
): number {
  if (audienceSignals.length === 0) return 40;
  const best = audienceSignals.reduce((highest, signal) => {
    const score = parseFactor(signal.confidence);
    return score > highest ? score : highest;
  }, 0);
  // Several segments is better evidence of who this is for than one.
  const breadth = Math.min(audienceSignals.length, 3) / 3;
  return clamp(best * 0.7 + breadth * 100 * 0.3);
}

export function assetAvailability(
  assets: readonly RecommendationAssetData[],
  channel: OpportunityChannel,
  hasSubjectEvidence: boolean,
): number {
  if (assets.length === 0) return hasSubjectEvidence ? 35 : 0;
  return clamp((40 + assets.length * 15) * (ASSET_CHANNEL_WEIGHT[channel] ?? 0.5));
}

/**
 * How well this destination suits the project, in four honest tiers.
 *
 * A platform the project has already published to is the strongest signal, and
 * that weight is derived from real usage by the context builder rather than
 * configured. Failing that, the CP09 content-type registry orders the platforms
 * it supports, and the first is the destination the type is defined for. A
 * platform the project can reach but has never published to is close behind:
 * still new coverage, still within capability. A platform it cannot reach scores
 * low rather than being excluded, so an explicit platform choice can still
 * outrank a default.
 */
export function platformFit(
  context: RecommendationContext,
  contentTypeId: string,
  platform: string,
  platformGaps: ReadonlySet<string>,
): number {
  const priority = context.platformPriority[platform];
  if (priority !== undefined) return clamp(priority);

  const supported = getContentType(contentTypeId)?.supportedPlatforms ?? [];
  const rank = supported.indexOf(platform);
  if (rank === 0) return 80;

  if (platformGaps.has(platform)) return 75;
  if (rank > 0) return 65;

  return context.availablePlatforms.includes(platform) ? 70 : 40;
}

/**
 * The subject being recommended, reduced to what scoring needs. Kept separate
 * from the context entity types so a workflow, a claim and a feature can all be
 * scored the same way without each needing its own factor.
 */
export type ScoreSubject = {
  type: string;
  id: string | null;
  confidence: number | string;
  /** Real grounding rows: Source documents and CP06 evidence. */
  evidenceCount: number;
};

/**
 * How well grounded this specific subject is, rather than the project as a whole.
 *
 * A project can hold one HIGH-confidence feature and three LOW-confidence ones;
 * scoring all of them by product confidence would rank them identically. Evidence
 * presence is added on top because a high-confidence entity carrying no
 * provenance rows has been asserted rather than grounded.
 */
export function subjectEvidence(
  subject: ScoreSubject | undefined,
  context: RecommendationContext,
): number {
  if (!subject) {
    return context.product ? parseFactor(context.product.confidence) : 0;
  }
  const grounding = parseFactor(subject.confidence);
  return clamp(grounding + (subject.evidenceCount > 0 ? 10 : 0));
}

export function buildScoreFactors(input: {
  context: RecommendationContext;
  history: ContentHistory;
  /** Output of the shared gap detector, keyed by content type id. */
  gaps: ReadonlyMap<string, ContentGap>;
  /** Platforms the project can reach but has never published to. */
  platformGaps: ReadonlySet<string>;
  contentTypeId: string;
  platform: string;
  channel: OpportunityChannel;
  subject?: ScoreSubject;
}): ScoreFactor[] {
  const {
    context,
    history,
    gaps,
    platformGaps,
    contentTypeId,
    platform,
    channel,
    subject,
  } = input;

  const grounding = subjectEvidence(subject, context);
  const factors: ScoreFactor[] = [];

  factors.push({
    name: "subjectEvidence",
    value: grounding,
    weight: SCORE_WEIGHTS.subjectEvidence,
    reason: describeGrounding(subject, context, grounding),
  });

  const coverage = featureCoverage(history, subject?.id ?? null);
  factors.push({
    name: "featureCoverage",
    value: coverage,
    weight: SCORE_WEIGHTS.featureCoverage,
    reason:
      coverage >= 100
        ? subject
          ? `No existing content covers this ${subject.type.toLowerCase()} yet.`
          : "No existing content covers this subject yet."
        : "Existing content already covers this subject, so the gain is smaller.",
  });

  const gap = contentGap(history, gaps, contentTypeId);
  factors.push({
    name: "contentGap",
    value: gap,
    weight: SCORE_WEIGHTS.contentGap,
    reason:
      gaps.get(contentTypeId)?.reason ??
      (gap >= 20
        ? "Content in this format already exists."
        : "This project cannot publish to any platform this format supports."),
  });

  const fit = audienceFit(context.audienceSignals);
  factors.push({
    name: "audienceFit",
    value: fit,
    weight: SCORE_WEIGHTS.audienceFit,
    reason:
      context.audienceSignals.length > 0
        ? `Grounded in ${context.audienceSignals.length} audience signal(s).`
        : "Audience is not yet characterised, so targeting is a guess.",
  });

  const assets = assetAvailability(
    context.assets,
    channel,
    grounding > 0,
  );
  factors.push({
    name: "assetAvailability",
    value: assets,
    weight: SCORE_WEIGHTS.assetAvailability,
    reason:
      context.assets.length > 0
        ? `${context.assets.length} existing asset(s) could be reused.`
        : "No reusable assets found yet.",
  });

  const platformScore = platformFit(
    context,
    contentTypeId,
    platform,
    platformGaps,
  );
  factors.push({
    name: "platformFit",
    value: platformScore,
    weight: SCORE_WEIGHTS.platformFit,
    reason: describePlatform(
      context,
      contentTypeId,
      platform,
      platformScore,
      platformGaps,
    ),
  });

  return factors;
}

export function totalScore(factors: readonly ScoreFactor[]): number {
  const total = factors.reduce(
    (sum, factor) => sum + clamp(factor.value) * factor.weight,
    0,
  );
  return Math.round(clamp(total) * 100) / 100;
}

export function reasonsFor(factors: readonly ScoreFactor[]): string[] {
  return factors
    .filter((factor) => factor.value >= 60)
    .sort((left, right) => right.value * right.weight - left.value * left.weight)
    .map((factor) => factor.reason);
}

function describeGrounding(
  subject: ScoreSubject | undefined,
  context: RecommendationContext,
  grounding: number,
): string {
  if (!subject) {
    return context.product
      ? `Product is ${describeConfidence(context.product.confidence)}.`
      : "No product description yet, so this is grounded mostly in individual entities.";
  }

  const ungrounded = subject.evidenceCount === 0;
  return ungrounded
    ? `${subject.type.toLowerCase()} is asserted without supporting evidence.`
    : `${subject.type.toLowerCase()} is ${describeConfidence(grounding)} and backed by ${subject.evidenceCount} grounding record(s).`;
}

function describePlatform(
  context: RecommendationContext,
  contentTypeId: string,
  platform: string,
  score: number,
  platformGaps: ReadonlySet<string>,
): string {
  // These strings are shown to a user as recommendation reasons, so the registry
  // display name is used rather than the stored id.
  const name = getPlatform(platform)?.name ?? platform;

  if (context.platformPriority[platform] !== undefined) {
    return `${name} is a destination this project already publishes to.`;
  }

  const supported = getContentType(contentTypeId)?.supportedPlatforms ?? [];
  if (supported[0] === platform) {
    return `${name} is the primary destination for this content type.`;
  }

  if (platformGaps.has(platform)) {
    return `${name} is available to this project but has not been published to yet.`;
  }

  return score >= 70
    ? `${name} is an available channel for this project.`
    : `${name} is a weaker fit for this project's channels.`;
}

function describeConfidence(confidence: number | string): string {
  if (typeof confidence === "number") {
    if (confidence >= 80) return "well evidenced";
    if (confidence >= 50) return "partly evidenced";
    return "lightly evidenced";
  }
  return confidence.toLowerCase();
}
