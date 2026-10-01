import type {
  ContentOpportunity,
  OpportunityEvidence,
} from "../domain/content-opportunity";
import {
  usableOpportunityTemplates,
  type OpportunityTemplate,
} from "../domain/opportunity-registry";
import { CONTENT_TYPES, getContentType } from "../domain/content-type";
import type { RecommendationContext } from "../domain/recommendation-context";
import { buildOpportunityKey } from "../../lib/recommendation-key";
import {
  detectContentGaps,
  detectPlatformGaps,
} from "./content-gap-detector";
import { buildScoreFactors, reasonsFor, totalScore } from "./recommendation-rules";
import { analyzeContentHistory } from "./content-history-analyzer";

/**
 * Recommendations are produced deterministically from the project context, with
 * no model involved. That is a deliberate constraint rather than a fallback: the
 * same project must produce the same opportunities in the same order on every
 * refresh, and every claim in the output has to trace back to something the
 * intelligence graph or brand profile actually says.
 *
 * The one place this would otherwise collapse is subject selection. If each
 * template simply took the first matching entity, every feature-driven template
 * would recommend the same feature and a project with eight features would hear
 * about one of them eight times. Subjects are therefore cycled per template.
 */

export type GenerateInput = {
  context: RecommendationContext;
  /** Maximum opportunities returned. */
  maximum?: number;
  /** ISO timestamp for created rows, injected so output is reproducible. */
  now: string;
};

export type Candidate = {
  template: OpportunityTemplate;
  /**
   * Stable identity of the thing being recommended. Computed once here so the
   * generated opportunity, the refinement prompt and the stored row all agree
   * without any of them re-deriving it.
   */
  key: string;
  platform: string;
  subjectType: ContentOpportunity["subjectType"];
  subjectId: string | null;
  subjectLabel: string;
  missingInputs: string[];
  score: number;
  reasons: string[];
};

const DEFAULT_MAXIMUM = 12;

/** A product has no entity id in the graph, so it is addressed by type. */
const PRODUCT_SUBJECT = {
  subjectType: "PRODUCT" as const,
  subjectId: null,
};

/**
 * A subject that could be recommended, carrying its own grounding. The confidence
 * and evidence count travel with the subject rather than being looked up again
 * during scoring, so a workflow, a claim and a feature are all scored on the same
 * footing without a per-type special case.
 */
type SubjectCandidate = {
  subjectType: ContentOpportunity["subjectType"];
  subjectId: string | null;
  subjectLabel: string;
  missingInputs: string[];
  confidence: number;
  evidenceCount: number;
};

/** Real grounding rows for an entity: Source documents plus CP06 evidence. */
function groundingCount(sourceCount: number, evidenceCount: number): number {
  return sourceCount + evidenceCount;
}

/**
 * Subjects available for a template, in a stable order. Truncating this list
 * per template is what produces variety: a template offers its first few
 * subjects, and each additional pass moves to the next one.
 */
function subjectsFor(
  context: RecommendationContext,
  template: OpportunityTemplate,
): SubjectCandidate[] {
  const subjects: SubjectCandidate[] = [];

  switch (template.preferredSubject) {
    case "PRODUCT": {
      if (context.product) {
        subjects.push({
          ...PRODUCT_SUBJECT,
          subjectLabel: context.product.name,
          missingInputs: [],
          confidence: context.product.confidence,
          // Counted from the product's own provenance like every other subject.
          // Hardcoding 0 both lost the ranking bonus and made the reason claim
          // the product was asserted without evidence while it was cited.
          evidenceCount: groundingCount(
            context.product.sourceIds.length,
            context.product.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "FEATURE": {
      for (const feature of context.features) {
        subjects.push({
          subjectType: "FEATURE",
          subjectId: feature.id,
          subjectLabel: feature.name,
          missingInputs:
            feature.evidenceIds.length > 0
              ? []
              : [`Evidence for "${feature.name}"`],
          confidence: feature.confidence,
          evidenceCount: groundingCount(
            feature.sourceIds.length,
            feature.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "WORKFLOW": {
      for (const workflow of context.workflows) {
        subjects.push({
          subjectType: "WORKFLOW",
          subjectId: workflow.id,
          subjectLabel: workflow.name,
          missingInputs:
            workflow.steps.length === 0
              ? [`Steps for "${workflow.name}"`]
              : [],
          confidence: workflow.confidence,
          evidenceCount: groundingCount(
            workflow.sourceIds.length,
            workflow.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "PROBLEM": {
      for (const problem of context.problems) {
        subjects.push({
          subjectType: "PROBLEM",
          subjectId: problem.id,
          subjectLabel: problem.name,
          missingInputs:
            problem.evidenceIds.length > 0
              ? []
              : [`Evidence for "${problem.name}"`],
          confidence: problem.confidence,
          evidenceCount: groundingCount(
            problem.sourceIds.length,
            problem.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "BENEFIT": {
      for (const benefit of context.benefits) {
        subjects.push({
          subjectType: "BENEFIT",
          subjectId: benefit.id,
          subjectLabel: benefit.name,
          missingInputs:
            benefit.evidenceIds.length > 0
              ? []
              : [`Evidence for "${benefit.name}"`],
          confidence: benefit.confidence,
          evidenceCount: groundingCount(
            benefit.sourceIds.length,
            benefit.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "CLAIM": {
      // Only supported claims may be recommended. An unverified or contradicted
      // claim is exactly the thing that must not become content.
      for (const claim of context.claims) {
        if (claim.verification !== "SUPPORTED") continue;
        subjects.push({
          subjectType: "CLAIM",
          subjectId: claim.id,
          subjectLabel: claim.text,
          missingInputs: [],
          confidence: claim.confidence,
          evidenceCount: groundingCount(
            claim.sourceIds.length,
            claim.evidenceIds.length,
          ),
        });
      }
      break;
    }
    case "ASSET": {
      for (const asset of context.assets) {
        subjects.push({
          subjectType: "PRODUCT",
          subjectId: asset.id,
          subjectLabel: asset.name,
          missingInputs: [],
          // An asset is its own grounding: the file exists and is described, so
          // there is nothing further to trace back to.
          confidence: 80,
          evidenceCount: 1,
        });
      }
      break;
    }
    default:
      break;
  }

  return subjects;
}

/**
 * Platforms a template can use, narrowed to what the project can actually publish
 * to *and* to what CP09 says the content type supports. A template with no usable
 * platform left is skipped rather than recommended on a channel the project has
 * no access to.
 *
 * The CP09 intersection is not redundant with `availablePlatforms`. A template's
 * `preferredPlatforms` is a hand-written shortlist, so it can drift from the
 * registry — and did: `video.social` listed `youtube_short`, which is a real
 * platform but not one CP09 supports for that content type. Filtering here means
 * such an entry is simply ignored, instead of producing a candidate the grounding
 * validator later rejects and the run silently throws away. The template keeps
 * the rest of its shortlist either way.
 */
function platformsFor(
  context: RecommendationContext,
  template: OpportunityTemplate,
): string[] {
  const available =
    context.availablePlatforms.length > 0
      ? new Set(context.availablePlatforms)
      : null;

  const supported = new Set(
    getContentType(template.contentTypeId)?.supportedPlatforms ?? [],
  );

  return template.preferredPlatforms.filter((platform) => {
    if (supported.size > 0 && !supported.has(platform)) return false;
    if (!available) return true;
    return available.has(platform);
  });
}

/**
 * Inputs a template needs beyond its subject, absent ones being reported to the
 * user as still outstanding.
 *
 * Named for the missing inputs rather than "gaps" on purpose: `content-gap-detector`
 * answers a different question — whether the project has covered this format at
 * all — and two different notions sharing one name made them easy to conflate.
 */
function missingTemplateInputs(
  context: RecommendationContext,
  template: OpportunityTemplate,
): string[] {
  const gaps: string[] = [];
  for (const input of template.requiredInputs) {
    if (input === "product" && !context.product) gaps.push("Product description");
    if (input === "brand" && !context.brand) gaps.push("Brand profile");
    if (input === "feature" && context.features.length === 0) gaps.push("Features");
    if (input === "workflow" && context.workflows.length === 0) gaps.push("Workflows");
    if (input === "problem" && context.problems.length === 0) gaps.push("Problems");
    if (input === "benefit" && context.benefits.length === 0) gaps.push("Benefits");
  }
  return gaps;
}

/**
 * Produces ranked candidates. Pure: same context in, same candidates out, in the
 * same order.
 */
export function createCandidates(context: RecommendationContext): Candidate[] {
  const candidates: Candidate[] = [];
  const seenKeys = new Set<string>();

  // One history for the whole pass. Coverage is read from here so ranking and the
  // `isProgress` the API serves are answers to the same question, and so the
  // index is not rebuilt once per candidate.
  const history = analyzeContentHistory(context, CONTENT_TYPES.map((t) => t.id));

  // Gap detection runs once for the whole pass, alongside the history. Both are
  // derived from the same shared analyzers rather than being re-decided per
  // candidate, so "this format is unused" cannot mean two different things
  // depending on which factor happens to ask.
  const gaps = new Map(
    detectContentGaps(context, history).map((gap) => [gap.contentTypeId, gap]),
  );
  const platformGaps = new Set(detectPlatformGaps(context));

  for (const template of usableOpportunityTemplates()) {
    const platforms = platformsFor(context, template);
    if (platforms.length === 0) continue;

    const subjects = subjectsFor(context, template);
    const missingInputsList = missingTemplateInputs(context, template);
    if (subjects.length === 0) continue;

    const definition = getContentType(template.contentTypeId);
    const channel = definition?.channel ?? "VIDEO";

    subjects.forEach((subject, subjectIndex) => {
      // Each subject gets its own platform so one feature does not produce the
      // same recommendation on three channels at once.
      const platform = platforms[subjectIndex % platforms.length];

      const missingInputs = [...missingInputsList, ...subject.missingInputs];

      const key = buildOpportunityKey({
        contentTypeId: template.contentTypeId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        platform,
        subjectLabel: subject.subjectLabel,
      });

      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const factors = buildScoreFactors({
        context,
        history,
        gaps,
        platformGaps,
        contentTypeId: template.contentTypeId,
        platform,
        channel,
        subject: {
          type: subject.subjectType,
          id: subject.subjectId,
          confidence: subject.confidence,
          evidenceCount: subject.evidenceCount,
        },
      });

      candidates.push({
        template,
        key,
        platform,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        subjectLabel: subject.subjectLabel,
        missingInputs,
        score: totalScore(factors),
        reasons: reasonsFor(factors),
      });
    });
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function titleFor(
  template: OpportunityTemplate,
  subjectLabel: string,
): string {
  switch (template.id) {
    case "product_demo":
      return `Product demo: ${subjectLabel}`;
    case "feature_demo":
      return `Demo the ${subjectLabel} feature`;
    case "feature_launch":
      return `Launch video for ${subjectLabel}`;
    case "explainer":
      return `Explainer: ${subjectLabel}`;
    case "before_after":
      return `Before and after: ${subjectLabel}`;
    case "workflow_carousel":
      return `Carousel: ${subjectLabel}`;
    case "feature_graphic":
      return `Graphic for ${subjectLabel}`;
    case "linkedin_post":
      return `LinkedIn post about ${subjectLabel}`;
    case "x_post":
      return `X post about ${subjectLabel}`;
    case "product_hunt":
      return `Product Hunt listing for ${subjectLabel}`;
    case "launch_campaign":
      return `Launch campaign for ${subjectLabel}`;
    default:
      return `${template.name}: ${subjectLabel}`;
  }
}

/**
 * `subjectsFor` admits only SUPPORTED claims, so a claim that is unverified or
 * contradicted cannot reach an output opportunity. The validator enforces the
 * same rule for opportunities that arrive from a refinement provider instead.
 */
export function generateOpportunities(input: GenerateInput): ContentOpportunity[] {
  const { context, now } = input;
  const maximum = input.maximum ?? DEFAULT_MAXIMUM;

  return createCandidates(context)
    .slice(0, maximum)
    .map((candidate) => {
      const definition = getContentType(candidate.template.contentTypeId);

      return {
        // The row does not exist yet, so there is no row id. `key` is the
        // identity that does exist, and it is what everything downstream
        // addresses this opportunity by.
        id: "",
        projectId: context.projectId,
        key: candidate.key,
        templateId: candidate.template.id,
        contentTypeId: candidate.template.contentTypeId,
        channel: definition?.channel ?? "VIDEO",
        platform: candidate.platform,
        subjectType: candidate.subjectType,
        subjectId: candidate.subjectId,
        subjectLabel: candidate.subjectLabel,
        title: titleFor(candidate.template, candidate.subjectLabel),
        rationale: candidate.template.rationaleTemplate,
        reasons: candidate.reasons,
        missingInputs: candidate.missingInputs,
        priorityScore: candidate.score,
        evidence: evidenceFor(candidate, context),
        status: "ACTIVE",
        selectedIntentId: null,
        dismissedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    });
}

/**
 * The grounding for an opportunity, keeping the three kinds of id apart.
 *
 * `sourceIds` are the Source documents the subject was extracted from, taken
 * from CP06 provenance. They are the only ids allowed to become a CP09 intent's
 * `sourceIds`, and CP09 validates them against real Source rows, so putting an
 * intelligence entity id here would produce an intent that fails to resolve its
 * own provenance. A workflow's features are related entities rather than
 * sources and are recorded as `entityIds`.
 */
function evidenceFor(
  candidate: Candidate,
  context: RecommendationContext,
): OpportunityEvidence {
  // A product-level recommendation has no entity subject to borrow provenance
  // from, so it carries the product record's own. Served empty, it would look
  // ungrounded when in fact the product came from the project's sources.
  if (!candidate.subjectId) {
    return {
      sourceIds: context.product?.sourceIds ?? [],
      evidenceIds: context.product?.evidenceIds ?? [],
      entityIds: [],
    };
  }

  switch (candidate.subjectType) {
    case "FEATURE": {
      const feature = context.features.find(
        (item) => item.id === candidate.subjectId,
      );
      return {
        sourceIds: feature?.sourceIds ?? [],
        evidenceIds: feature?.evidenceIds ?? [],
        entityIds: [],
      };
    }
    case "WORKFLOW": {
      const workflow = context.workflows.find(
        (item) => item.id === candidate.subjectId,
      );
      return {
        sourceIds: workflow?.sourceIds ?? [],
        evidenceIds: workflow?.evidenceIds ?? [],
        entityIds: workflow?.featureIds ?? [],
      };
    }
    case "PROBLEM":
    case "BENEFIT":
    case "CLAIM": {
      const match =
        candidate.subjectType === "PROBLEM"
          ? context.problems.find((item) => item.id === candidate.subjectId)
          : candidate.subjectType === "BENEFIT"
            ? context.benefits.find((item) => item.id === candidate.subjectId)
            : context.claims.find((item) => item.id === candidate.subjectId);
      return {
        sourceIds: match?.sourceIds ?? [],
        evidenceIds: match?.evidenceIds ?? [],
        entityIds: [],
      };
    }
    default:
      // An unrecognised subject type is not something to invent provenance for.
      return { sourceIds: [], evidenceIds: [], entityIds: [] };
  }
}
