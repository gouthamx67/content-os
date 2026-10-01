import type { ContentOpportunity } from "../domain/content-opportunity";
import { getContentType } from "../domain/content-type";
import { isKnownPlatform } from "../domain/platform";
import type { RecommendationContext } from "../domain/recommendation-context";

/**
 * The validator is the boundary between "a string the engine produced" and "a
 * recommendation the engine is willing to stand behind". It exists because the
 * output is advisory text derived from a model-written graph, and because a model
 * may later refine it — both paths need the same gate.
 *
 * The rules are deliberately about grounding, not taste. A recommendation with
 * gaps is allowed: gaps are shown. A recommendation that claims support it does
 * not have is not, because the user has no way to tell the difference.
 */

export type ValidationIssue = {
  /**
   * The opportunity's stable key, not its row id. A generated opportunity has no
   * row id yet, so keying issues by id would put every one of them in the same
   * bucket and make `filterValid` discard the entire batch on a single problem.
   */
  opportunityKey: string;
  rule:
    | "UNKNOWN_CONTENT_TYPE"
    | "UNKNOWN_PLATFORM"
    | "CHANNEL_MISMATCH"
    | "PLATFORM_NOT_SUPPORTED"
    | "UNGROUNDED_SUBJECT"
    | "UNSUPPORTED_CLAIM"
    | "MISSING_REASON"
    | "MISSING_TITLE"
    | "MISSING_RATIONALE";
  detail: string;
};

export type ValidationResult = {
  isValid: boolean;
  issues: ValidationIssue[];
};

export class ContentRecommendationValidator {
  validate(
    opportunities: readonly ContentOpportunity[],
    context: RecommendationContext,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (const opportunity of opportunities) {
      issues.push(...this.validateOne(opportunity, context));
    }

    return { isValid: issues.length === 0, issues };
  }

  private validateOne(
    opportunity: ContentOpportunity,
    context: RecommendationContext,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const push = (rule: ValidationIssue["rule"], detail: string) => {
      issues.push({ opportunityKey: opportunity.key, rule, detail });
    };

    const definition = getContentType(opportunity.contentTypeId);
    if (!definition) {
      push("UNKNOWN_CONTENT_TYPE", `Unknown content type ${opportunity.contentTypeId}`);
      // Nothing downstream can be checked without the definition.
      return issues;
    }

    if (definition.channel !== opportunity.channel) {
      push(
        "CHANNEL_MISMATCH",
        `${opportunity.contentTypeId} is a ${definition.channel} channel, not ${opportunity.channel}`,
      );
    }

    if (!isKnownPlatform(opportunity.platform)) {
      push("UNKNOWN_PLATFORM", `Unknown platform ${opportunity.platform}`);
    } else if (!definition.supportedPlatforms.includes(opportunity.platform)) {
      push(
        "PLATFORM_NOT_SUPPORTED",
        `${opportunity.contentTypeId} does not support ${opportunity.platform}`,
      );
    }

    if (!this.subjectExists(opportunity, context)) {
      push(
        "UNGROUNDED_SUBJECT",
        `Subject ${opportunity.subjectType}:${opportunity.subjectId ?? "none"} is not in the project context`,
      );
    }

    // A claim subject is only grounded when the claim is supported. An
    // unverified or contradicted claim must never become recommended content.
    if (opportunity.subjectType === "CLAIM") {
      const claim = context.claims.find((item) => item.id === opportunity.subjectId);
      if (!claim) {
        push("UNSUPPORTED_CLAIM", "Claim subject is not in the project context");
      } else if (claim.verification !== "SUPPORTED") {
        push(
          "UNSUPPORTED_CLAIM",
          `Claim "${claim.text}" is ${claim.verification}, not SUPPORTED`,
        );
      }
    }

    if (opportunity.reasons.length === 0) {
      push(
        "MISSING_REASON",
        "An unexplained recommendation cannot be shown to a user",
      );
    }

    if (opportunity.title.trim().length === 0) {
      push("MISSING_TITLE", "Recommendation has no title");
    }

    if (opportunity.rationale.trim().length === 0) {
      push("MISSING_RATIONALE", "Recommendation has no rationale");
    }

    return issues;
  }

  /**
   * Every subject must correspond to something the project actually has. The
   * product and brand are the deliberate exceptions: they are project-level
   * context rather than graph entities.
   */
  private subjectExists(
    opportunity: ContentOpportunity,
    context: RecommendationContext,
  ): boolean {
    if (opportunity.subjectType === "PRODUCT" && opportunity.subjectId === null) {
      return context.product !== null;
    }

    if (!opportunity.subjectId) return false;

    switch (opportunity.subjectType) {
      case "FEATURE":
        return context.features.some((item) => item.id === opportunity.subjectId);
      case "WORKFLOW":
        return context.workflows.some((item) => item.id === opportunity.subjectId);
      case "PROBLEM":
        return context.problems.some((item) => item.id === opportunity.subjectId);
      case "BENEFIT":
        return context.benefits.some((item) => item.id === opportunity.subjectId);
      case "CLAIM":
        return context.claims.some((item) => item.id === opportunity.subjectId);
      case "PRODUCT":
        // Asset-addressed opportunities use PRODUCT with an asset id.
        return context.assets.some((item) => item.id === opportunity.subjectId);
      default:
        return false;
    }
  }

  /** Keeps the well-formed subset of a refined batch. */
  filterValid(
    opportunities: readonly ContentOpportunity[],
    context: RecommendationContext,
  ): ContentOpportunity[] {
    const { issues } = this.validate(opportunities, context);
    const broken = new Set(issues.map((issue) => issue.opportunityKey));
    return opportunities.filter((opportunity) => !broken.has(opportunity.key));
  }
}
