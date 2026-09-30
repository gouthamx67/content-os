/**
 * A direction's strength is a measurement of how much of the project it uses
 * well, not a verdict on whether it is the right one. It exists so the service
 * can order a run and so a regression in what a director is given is visible;
 * the panel deliberately does not present it as a score out of ten.
 *
 * Seven independent components, each 0-1, weighted to a 1-100 total.
 */

import type {
  CreativeContext,
  CreativeContextAsset,
} from "../domain/creative-context";
import type {
  CreativeDirection,
  CreativeDirectionDraft,
} from "../domain/creative-direction";

/**
 * The creative half of a direction, which is all the scorer reads. Taking a
 * draft means a direction can be scored before it is stored, and scored the
 * same way both times.
 */
export type ScorableDirection = Pick<
  CreativeDirection,
  keyof CreativeDirectionDraft
>;

export interface StrengthComponents {
  thesisClarity: number;
  hookStrength: number;
  audienceRelevance: number;
  evidenceDensity: number;
  brandAlignment: number;
  visualSpecificity: number;
  narrativeCoherence: number;
}

export const STRENGTH_WEIGHTS: Readonly<Record<keyof StrengthComponents, number>> = {
  thesisClarity: 0.2,
  hookStrength: 0.15,
  audienceRelevance: 0.15,
  evidenceDensity: 0.2,
  brandAlignment: 0.1,
  visualSpecificity: 0.1,
  narrativeCoherence: 0.1,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** A thesis that states one thing and is short enough to remember. */
function thesisClarity(direction: ScorableDirection): number {
  const words = direction.thesis.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  if (words <= 18) return 1;
  if (words <= 30) return 0.8;
  if (words <= 45) return 0.5;
  return 0.3;
}

/** An opening works when it says something, explains how, and lands a feeling. */
function hookStrength(direction: ScorableDirection): number {
  const { statement, mechanism, emotionalTrigger } = direction.hook;
  let score = 0;
  if (statement.trim().length >= 8) score += 0.4;
  if (statement.trim().length >= 24) score += 0.15;
  if (mechanism.trim().length >= 8) score += 0.25;
  if (emotionalTrigger.trim().length >= 3) score += 0.2;
  // An opening that only restates the thesis has not earned its place.
  if (
    statement.trim() &&
    statement.trim().toLowerCase() === direction.thesis.trim().toLowerCase()
  ) {
    score *= 0.5;
  }
  return clamp01(score);
}

/** Uses what the project and the request actually named about the audience. */
function audienceRelevance(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  const wanted = [
    context.intent.audience,
    context.product.audienceSummary,
    context.intent.purpose,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.toLowerCase());

  if (wanted.length === 0) return 0.5;
  const haystack = [
    direction.audienceAngle,
    direction.thesis,
    direction.narrativeSummary,
  ]
    .join(" ")
    .toLowerCase();

  const hits = wanted.filter((term) => {
    const keywords = term
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 4);
    return keywords.some((word) => haystack.includes(word));
  }).length;

  return clamp01(hits / Math.min(wanted.length, 2));
}

/** Proof that leans on the evidence the project has, and spends it. */
function evidenceDensity(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  const availableClaims = context.product.claims.filter(isUsableClaim);
  const availableEvidence = context.evidence;
  if (availableClaims.length === 0 && availableEvidence.length === 0) {
    // Nothing to lean on: an honest direction scores low here rather than
    // inventing proof to fill the component.
    return direction.proofStrategy.proofPoints.length > 0 ? 0.3 : 0;
  }

  const knownClaimIds = new Set(availableClaims.map((claim) => claim.id));
  const knownEvidenceIds = new Set(availableEvidence.map((item) => item.id));
  const usedClaims = direction.proofStrategy.claimIds.filter((id) =>
    knownClaimIds.has(id),
  );
  const usedEvidence = direction.proofStrategy.evidenceIds.filter((id) =>
    knownEvidenceIds.has(id),
  );

  const claimShare =
    availableClaims.length === 0
      ? 0
      : clamp01(usedClaims.length / Math.min(availableClaims.length, 3));
  const evidenceShare =
    availableEvidence.length === 0
      ? 0
      : clamp01(usedEvidence.length / Math.min(availableEvidence.length, 3));
  const explained = clamp01(direction.proofStrategy.proofPoints.length / 3);

  return clamp01(claimShare * 0.35 + evidenceShare * 0.35 + explained * 0.3);
}

/** Speaks in the brand's own recorded words rather than in generic ad language. */
function brandAlignment(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  const terms = [
    ...context.brand.tone,
    ...context.brand.style,
    context.brand.executionSummary,
    context.intent.tone ?? "",
    context.intent.style ?? "",
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .flatMap((value) => value.toLowerCase().split(/\s+/))
    .filter((word) => word.length > 3);

  if (terms.length === 0) return 0.5;
  const haystack = [
    direction.voiceDirection,
    direction.narrativeSummary,
    direction.hook.statement,
    direction.thesis,
  ]
    .join(" ")
    .toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return clamp01(hits / Math.min(terms.length, 3));
}

/** A look that could be acted on, with the product actually in it. */
function visualSpecificity(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  let score = 0;
  if (direction.visualStrategy.approach.trim().length >= 20) score += 0.35;
  if (direction.visualStrategy.rationale.trim().length >= 20) score += 0.25;
  score +=
    clamp01(direction.visualStrategy.productMoments.length / 2) * 0.25;
  if (
    context.assets.some((asset) => asset.isProductUi) &&
    direction.visualStrategy.productMoments.length > 0
  ) {
    score += 0.15;
  }
  return clamp01(score);
}

/** Everything in the direction points at the same product, problem and outcome. */
function narrativeCoherence(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  const anchors = [
    context.product.name,
    context.product.valueProposition,
    ...context.product.features.map((feature) => feature.name),
    ...context.product.benefits.map((benefit) => benefit.description),
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 2))
    .map((value) => value.toLowerCase())
    .flatMap((value) => value.split(/\s+/))
    .filter((word) => word.length > 3);

  if (anchors.length === 0) return 0.5;
  const haystack = [
    direction.narrativeSummary,
    direction.hook.statement,
    direction.audienceAngle,
    direction.emotionalAngle,
  ]
    .join(" ")
    .toLowerCase();
  const hits = anchors.filter((anchor) => haystack.includes(anchor)).length;

  let score = clamp01(hits / Math.min(anchors.length, 3));
  // A call to action the request never asked for is drift, not coherence.
  if (!context.intent.cta && direction.cta) score *= 0.6;
  return clamp01(score);
}

function isUsableClaim(claim: CreativeContext["product"]["claims"][number]): boolean {
  return claim.verification === "SUPPORTED" || claim.verification === "PARTIALLY_SUPPORTED";
}

export function isProductUiAsset(asset: CreativeContextAsset): boolean {
  return (
    asset.isProductUi ||
    asset.type === "PRODUCT_UI" ||
    asset.type === "SCREENSHOT" ||
    asset.role === "PRODUCT_UI" ||
    asset.role === "FEATURE_PROOF"
  );
}

export function strengthComponents(
  direction: ScorableDirection,
  context: CreativeContext,
): StrengthComponents {
  return {
    thesisClarity: thesisClarity(direction),
    hookStrength: hookStrength(direction),
    audienceRelevance: audienceRelevance(direction, context),
    evidenceDensity: evidenceDensity(direction, context),
    brandAlignment: brandAlignment(direction, context),
    visualSpecificity: visualSpecificity(direction, context),
    narrativeCoherence: narrativeCoherence(direction, context),
  };
}

/** 1-100, rounded. The persisted strength of a direction. */
export function scoreDirection(
  direction: ScorableDirection,
  context: CreativeContext,
): number {
  const components = strengthComponents(direction, context);
  const total = (Object.keys(STRENGTH_WEIGHTS) as Array<keyof StrengthComponents>)
    .reduce((sum, key) => sum + components[key] * STRENGTH_WEIGHTS[key], 0);

  return Math.round(clamp01(total) * 100);
}
