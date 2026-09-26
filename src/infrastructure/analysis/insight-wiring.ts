import {
  canonicalEntityKey,
  isDuplicateEntity,
} from "../../core/domain/intelligence-canonical";
import { addDraftEvidence, type IntelligenceDraft } from "../../core/domain/intelligence-draft";
import type {
  EvidenceKind,
  IntelligenceConfidence,
} from "../../core/domain/intelligence";
import {
  extractBenefits,
  extractProblems,
  extractWorkflows,
  linksToFeature,
  type InsightCandidate,
} from "./insight-extraction";
import { truncate } from "./text";

/**
 * Writes the three narrative families into a draft as real entities with real
 * provenance, then links them to the features the same source already produced.
 *
 * Every entity here is traceable to an excerpt the source actually contains, and
 * every relationship is derived from a link the extraction found, not assumed.
 */
export interface InsightWiringOptions {
  sourceId: string;
  evidenceKind: EvidenceKind;
  confidence: IntelligenceConfidence;
  candidates: readonly InsightCandidate[];
  /** Feature key to the heading it came from, for section-scoped linkage. */
  featureSections?: ReadonlyMap<string, string>;
  limits?: Partial<Record<"problems" | "benefits" | "workflows", number>>;
}

export function applyInsightExtraction(
  draft: IntelligenceDraft,
  options: InsightWiringOptions,
): void {
  const { sourceId, evidenceKind, confidence, candidates, featureSections } = options;
  const features = draft.features.map((feature) => ({
    key: feature.key,
    name: feature.name,
    section: featureSections?.get(feature.key) ?? null,
  }));
  const featureNames = features.map((feature) => feature.name);

  const problems = extractProblems(candidates, featureNames, options.limits?.problems);
  const benefits = extractBenefits(candidates, featureNames, options.limits?.benefits);
  const workflows = extractWorkflows(candidates, options.limits?.workflows);

  const evidence = (
    candidate: { locator: string | null; excerpt: string },
    suffix: string,
  ): string =>
    addDraftEvidence(draft, {
      sourceId,
      kind: evidenceKind,
      locator: candidate.locator ? `${candidate.locator}:${suffix}` : `insight:${suffix}`,
      excerpt: truncate(candidate.excerpt, 500),
      metadata: null,
    }).key;

  for (const [index, problem] of problems.entries()) {
    const key = canonicalEntityKey("PROBLEM", problem.name);
    if (draft.problems.some((existing) => existing.key === key)) continue;
    if (draft.problems.some((existing) => isDuplicateEntity(problem.name, existing.name))) continue;
    const evidenceKey = evidence(problem, `problem:${index}`);
    draft.problems.push({
      key,
      name: problem.name,
      description: problem.description,
      confidence: problem.confidence,
      assertionKind: "FACT",
      sourceIds: [sourceId],
      evidenceKeys: [evidenceKey],
    });
    draft.relationships.push({
      type: "PROBLEM_SUPPORTED_BY_EVIDENCE",
      fromType: "PROBLEM",
      fromKey: key,
      toType: "EVIDENCE",
      toKey: evidenceKey,
      confidence: problem.confidence,
    });
    for (const feature of features) {
      if (!linksToFeature(problem.excerpt, feature.name, problem.section, feature.section)) continue;
      draft.relationships.push({
        type: "FEATURE_SOLVES_PROBLEM",
        fromType: "FEATURE",
        fromKey: feature.key,
        toType: "PROBLEM",
        toKey: key,
        confidence: problem.confidence,
      });
    }
  }

  for (const [index, benefit] of benefits.entries()) {
    const key = canonicalEntityKey("BENEFIT", benefit.name);
    if (draft.benefits.some((existing) => existing.key === key)) continue;
    if (draft.benefits.some((existing) => isDuplicateEntity(benefit.name, existing.name))) continue;
    const evidenceKey = evidence(benefit, `benefit:${index}`);
    const linkedFeatureKeys: string[] = [];
    for (const feature of features) {
      if (!linksToFeature(benefit.excerpt, feature.name, benefit.section, feature.section)) continue;
      linkedFeatureKeys.push(feature.key);
      draft.relationships.push({
        type: "FEATURE_PROVIDES_BENEFIT",
        fromType: "FEATURE",
        fromKey: feature.key,
        toType: "BENEFIT",
        toKey: key,
        confidence: benefit.confidence,
      });
    }
    draft.benefits.push({
      key,
      name: benefit.name,
      description: benefit.description,
      linkedFeatureKeys,
      confidence: benefit.confidence,
      assertionKind: "FACT",
      sourceIds: [sourceId],
      evidenceKeys: [evidenceKey],
    });
    draft.relationships.push({
      type: "BENEFIT_SUPPORTED_BY_EVIDENCE",
      fromType: "BENEFIT",
      fromKey: key,
      toType: "EVIDENCE",
      toKey: evidenceKey,
      confidence: benefit.confidence,
    });
  }

  for (const [index, workflow] of workflows.entries()) {
    const key = canonicalEntityKey("WORKFLOW", workflow.name);
    if (draft.workflows.some((existing) => existing.key === key)) continue;
    if (draft.workflows.some((existing) => isDuplicateEntity(workflow.name, existing.name))) continue;
    const evidenceKey = evidence(workflow, `workflow:${index}`);
    const featureKeys = new Set<string>();
    const steps = workflow.steps.map((step, order) => {
      const stepFeatures = features
        .filter((feature) => linksToFeature(step.action, feature.name, workflow.section, feature.section))
        .map((feature) => feature.key);
      for (const featureKey of stepFeatures) featureKeys.add(featureKey);
      return {
        order: order + 1,
        action: step.action,
        description: step.description.length > 0 ? step.description : null,
        featureKeys: stepFeatures,
      };
    });
    draft.workflows.push({
      key,
      name: workflow.name,
      description: workflow.excerpt,
      steps,
      featureKeys: [...featureKeys],
      confidence,
      assertionKind: "FACT",
      sourceIds: [sourceId],
      evidenceKeys: [evidenceKey],
    });
    for (const featureKey of featureKeys) {
      draft.relationships.push({
        type: "WORKFLOW_USES_FEATURE",
        fromType: "WORKFLOW",
        fromKey: key,
        toType: "FEATURE",
        toKey: featureKey,
        confidence,
      });
    }
  }
}
