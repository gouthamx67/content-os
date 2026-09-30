/**
 * The deterministic director builds directions from the ten styles using only
 * what the context contains. It is the floor the system stands on: with no model
 * configured, or when a model's output is refused, the project can still get
 * real options rather than an error.
 *
 * It is also the reason the styles are functions over facts. A style cannot
 * produce a claim the intelligence graph does not hold, because it has no way
 * to name one.
 */

import {
  CREATIVE_STYLE_IDS,
  draftFromStyle,
  type CreativeStyle,
  type CreativeStyleBuild,
  type CreativeStyleFacts,
  type CreativeStyleId,
  CREATIVE_STYLES,
} from "../domain/creative-style";
import type { CreativeContext } from "../domain/creative-context";
import type {
  CreativeAngle,
  CreativeDirectionDraft,
} from "../domain/creative-direction";
import type {
  CreativeDirectionProposal,
  CreativeDirector,
  CreativeDirectorRequest,
  CreativeDirectorResult,
} from "../ports/creative-director";
import { isProductUiAsset } from "./creative-strength";

/** Claims a direction is allowed to rest on. */
function usableClaims(context: CreativeContext) {
  return context.product.claims.filter(
    (claim) =>
      claim.verification === "SUPPORTED" ||
      claim.verification === "PARTIALLY_SUPPORTED",
  );
}

/** Turns the context into the flat, grounded material the styles read. */
/**
 * Facts are read as phrases, not sentences. The intelligence graph stores
 * descriptions that end in a full stop, and a recipe that interpolates one
 * mid-sentence then produces "engineering teams., one step at a time." So the
 * terminal punctuation is dropped here, once, and each template owns the
 * punctuation around what it inserts.
 */
function phrase(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/[.!?]+$/, "").trim();
}

export function factsFromContext(context: CreativeContext): CreativeStyleFacts {
  const product = context.product;
  const claims = usableClaims(context);
  const productUiAssets = context.assets
    .filter(isProductUiAsset)
    .map((asset) => ({ id: asset.id, name: asset.name }));

  const evidenceIds = [
    ...new Set(claims.flatMap((claim) => claim.evidenceIds)),
  ].filter((id) => context.evidence.some((item) => item.id === id));

  const feature = product.features[0];
  const problem = product.problems[0];
  const benefit = product.benefits[0];
  const workflow = product.workflows[0];

  return {
    productName: phrase(product.name) || "this product",
    valueProposition: phrase(
      product.valueProposition || feature?.description || problem?.description,
    ),
    problemStatement: phrase(problem?.description),
    problemDetail: phrase(problem?.description),
    featureStatement: phrase(feature?.name || feature?.description),
    featureDetail: phrase(feature?.description),
    benefitStatement: phrase(benefit?.description),
    workflowStatement: phrase(workflow?.name),
    audienceSummary: phrase(
      context.intent.audience || product.audienceSummary,
    ) || "the people this is for",
    brandVoiceSummary: phrase(context.brand.executionSummary),
    cta: context.intent.cta,
    supportedClaimIds: claims.map((claim) => claim.id),
    supportedEvidenceIds: evidenceIds,
    supportedClaimTexts: claims.map((claim) => claim.text),
    productUiAssets,
    supportingAssetNames: context.assets.map((asset) => asset.name),
    hasEvidence: context.evidence.length > 0,
  };
}

/** A stand-in for a fact, used to measure whether a recipe reads it. */
const SENTINEL = "\u0000";

/** The fact fields a recipe can read. */
const FACT_KEYS: ReadonlyArray<keyof CreativeStyleFacts> = [
  "productName",
  "valueProposition",
  "problemStatement",
  "featureStatement",
  "benefitStatement",
  "workflowStatement",
  "audienceSummary",
  "brandVoiceSummary",
];

/**
 * Facts a recipe already guards with a `||` fallback of its own. Every style
 * falls back to a house voice when the brand profile is empty, and the workflow
 * style falls back to the value proposition, so neither is a reason to refuse a
 * style. Any other fact a recipe reads has to be there.
 */
const TOLERATED_EMPTY: ReadonlySet<keyof CreativeStyleFacts> = new Set([
  "brandVoiceSummary",
  "workflowStatement",
]);

/** Every word a recipe produces, as one comparable string. */
function renderedText(build: CreativeStyleBuild): string {
  return [
    build.name,
    build.thesis,
    build.hookStatement,
    build.hookMechanism,
    build.hookEmotionalTrigger,
    build.audienceAngle,
    build.emotionalAngle,
    build.narrativeSummary,
    build.visualApproach,
    build.visualRationale,
    build.voiceDirection,
    build.musicDirection,
    build.soundDirection,
    build.rationale,
    ...build.productMoments,
    ...build.proofPoints,
    ...build.assetIds,
  ].join("\u0001");
}

function withFact(
  facts: CreativeStyleFacts,
  key: keyof CreativeStyleFacts,
  value: string,
): CreativeStyleFacts {
  return { ...facts, [key]: value };
}

/** A stand-in fact set, used only to probe a recipe for the facts it reads. */
const factsProbe: CreativeStyleFacts = {
  productName: "probe",
  valueProposition: "probe",
  problemStatement: "probe",
  problemDetail: "probe",
  featureStatement: "probe",
  featureDetail: "probe",
  benefitStatement: "probe",
  workflowStatement: "probe",
  audienceSummary: "probe",
  brandVoiceSummary: "probe",
  cta: null,
  supportedClaimIds: [],
  supportedEvidenceIds: [],
  supportedClaimTexts: [],
  productUiAssets: [],
  supportingAssetNames: [],
  hasEvidence: false,
};

/**
 * The facts a recipe cannot say anything without.
 *
 * Measured from the recipe rather than declared beside it, or looked up from the
 * angle, because both go stale: a recipe that starts naming a benefit has to
 * start needing one, and a table somewhere else will not notice. Rendering the
 * same recipe with a fact present and then absent, and seeing whether the
 * output moves, is the only check that cannot fall behind the thing it checks.
 */
function requiredFacts(
  style: CreativeStyle,
): ReadonlyArray<keyof CreativeStyleFacts> {
  return FACT_KEYS.filter((key) => {
    if (TOLERATED_EMPTY.has(key)) return false;
    const present = renderedText(style.build(withFact(factsProbe, key, SENTINEL)));
    const absent = renderedText(style.build(withFact(factsProbe, key, "")));
    return present !== absent;
  });
}

function isEmptyFact(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== "string" || value.trim().length === 0;
}

/**
 * Whether this project holds every fact the style needs.
 *
 * A recipe that names a benefit the intelligence run never found does not fail
 * loudly. It renders "One idea: ", and "the visible difference  makes", and
 * hands the user something that looks like a direction. Better to offer fewer
 * styles than to offer those.
 */
function hasRequiredFacts(style: CreativeStyle, facts: CreativeStyleFacts): boolean {
  return requiredFacts(style).every((key) => !isEmptyFact(facts[key]));
}

/** A rendered draft with a hole in it is not worth showing a user. */
function hasHollowFields(draft: CreativeDirectionDraft): boolean {
  const required: Array<string | null> = [
    draft.name,
    draft.thesis,
    draft.hook.statement,
    draft.hook.mechanism,
    draft.hook.emotionalTrigger,
    draft.audienceAngle,
    draft.emotionalAngle,
    draft.narrativeSummary,
    draft.visualStrategy.approach,
    draft.visualStrategy.rationale,
    draft.voiceDirection,
    draft.musicDirection,
    draft.soundDirection,
    draft.rationale,
  ];

  return (
    required.some((value) => !value || value.trim().length === 0) ||
    draft.visualStrategy.productMoments.length === 0 ||
    draft.proofStrategy.proofPoints.length === 0
  );
}

/**
 * How well a style fits this project right now. Deterministic, explainable, and
 * used only to choose which styles to offer - the user still decides.
 */
function styleFitness(
  style: CreativeStyle,
  facts: CreativeStyleFacts,
  context: CreativeContext,
): number {
  const policy = context.policy;
  let score = 0;

  if (policy.allowedAngles.includes(style.angles[0])) score += 2;
  if (policy.allowConceptualVisuals) score += 1;

  const hasProductUi = facts.productUiAssets.length > 0;
  const wantsProductUi = style.angles.includes("PRODUCT_FIRST") ||
    style.angles.includes("WORKFLOW") ||
    style.angles.includes("BEFORE_AFTER") ||
    style.angles.includes("DEMO");
  if (wantsProductUi && hasProductUi) score += 3;
  if (wantsProductUi && !hasProductUi) score -= policy.requireProductUi ? 99 : 1;
  if (!wantsProductUi && !hasProductUi) score += 1;

  if (style.angles.includes("EMOTIONAL") || style.angles.includes("SOCIAL")) {
    if (!policy.allowMetaphor) score -= 1;
  }
  if (style.angles.includes("EDUCATIONAL") && facts.problemStatement) score += 1;
  if (style.angles.includes("FOUNDER") && facts.problemStatement) score += 1;
  if (style.angles.includes("WORKFLOW") && facts.workflowStatement) score += 2;
  if (style.angles.includes("BEFORE_AFTER") && facts.problemStatement && facts.benefitStatement) {
    score += 1;
  }
  if (facts.supportedClaimIds.length > 0) score += 1;
  if (context.intent.durationSeconds && context.intent.durationSeconds <= 30) {
    if (style.angles.includes("SOCIAL")) score += 1;
    if (style.angles.includes("TRANSFORMATION")) score += 0.5;
  }
  if (context.intent.platforms.some((platform) =>
    /instagram|tiktok|reel|short/i.test(platform),
  )) {
    if (style.angles.includes("SOCIAL") || style.angles.includes("EMOTIONAL")) {
      score += 1;
    }
  }

  return score;
}

function primaryClaimIds(
  context: CreativeContext,
  limit: number,
): { claimIds: string[]; evidenceIds: string[] } {
  const claims = usableClaims(context);
  const knownEvidenceIds = new Set(context.evidence.map((item) => item.id));
  const claimIds = claims.slice(0, limit).map((claim) => claim.id);
  // A claim's evidence list is recorded, so a stale relationship can name an
  // evidence row the project no longer holds. Citing it would be a reference to
  // nothing, so only ids the context actually carries survive.
  const evidenceIds = [
    ...new Set(
      claims
        .filter((claim) => claimIds.includes(claim.id))
        .flatMap((claim) => claim.evidenceIds),
    ),
  ]
    .filter((id) => knownEvidenceIds.has(id))
    .slice(0, limit);

  return { claimIds, evidenceIds };
}

function angleForStyle(
  style: CreativeStyle,
  context: CreativeContext,
): CreativeAngle {
  const permitted = style.angles.filter((angle) =>
    context.policy.allowedAngles.includes(angle),
  );
  return permitted[0] ?? style.angles[0];
}

export class DeterministicCreativeDirector implements CreativeDirector {
  readonly id = "deterministic-creative-director";

  async generate(request: CreativeDirectorRequest): Promise<CreativeDirectorResult> {
    const { context, count } = request;
    const facts = factsFromContext(context);

    const requested = new Set<CreativeStyleId>(request.angles as CreativeStyleId[]);
    const candidates = CREATIVE_STYLE_IDS.filter((styleId) => {
      const style = CREATIVE_STYLES[styleId];
      if (requested.size > 0 && !requested.has(styleId)) return false;
      if (!hasRequiredFacts(style, facts)) return false;
      return style.angles.some((angle) => context.policy.allowedAngles.includes(angle));
    });

    const ranked = candidates
      .map((styleId) => {
        const style = CREATIVE_STYLES[styleId];
        return { styleId, style, fitness: styleFitness(style, facts, context) };
      })
      .filter((entry) => entry.fitness > -50)
      .sort((left, right) => right.fitness - left.fitness);

    // The service owns the 3-5 range a user is offered. This cap is a backstop
    // so a direct caller cannot ask the styles for a wall of options.
    const chosen = ranked.slice(0, Math.min(Math.max(count, 1), 5));

    const proposals: CreativeDirectionProposal[] = chosen
      .map((entry, index) => {
        const { claimIds, evidenceIds } = primaryClaimIds(context, index === 0 ? 3 : 2);
        const draft = draftFromStyle(
          { ...entry.style, angles: [angleForStyle(entry.style, context)] },
          facts,
          { claimIds, evidenceIds, cta: context.intent.cta },
        );

        return {
          id: `style-${entry.styleId.toLowerCase()}`,
          name: draft.name,
          description: entry.style.description,
          draft,
        };
      })
      // Belt and braces against the lead-fact check above: a style that still
      // renders an empty required field is dropped rather than proposed.
      .filter((proposal) => !hasHollowFields(proposal.draft));

    return { provider: this.id, model: null, proposals };
  }
}

export function deterministicStyleIds(): CreativeStyleId[] {
  return [...CREATIVE_STYLE_IDS];
}
