import { buildFacts } from "../context/context-facts";
import type {
  WritingBrandContext,
  WritingContext,
  WritingProductContext,
} from "../domain/types";

export function productContext(
  overrides: Partial<WritingProductContext> = {},
): WritingProductContext {
  return {
    name: "Northwind Analytics",
    category: "Scheduling",
    purpose: "Keep engineering teams aligned on delivery",
    shortDescription: "a scheduling tool for engineering teams",
    longDescription:
      "Northwind Analytics schedules exports and reports status automatically",
    valueProposition: "a single source of truth for delivery status",
    targetUser: "engineering leads",
    sourceIds: ["source_1"],
    features: [
      {
        id: "feature_1",
        name: "Scheduled exports",
        description: "Scheduled exports send a status report on a fixed schedule",
        sourceIds: ["source_1"],
      },
    ],
    benefits: [
      {
        id: "benefit_1",
        name: "Fewer status meetings",
        description: "Engineering leads report progress to stakeholders every week",
        sourceIds: ["source_2"],
      },
    ],
    problems: [
      {
        id: "problem_1",
        name: "Scattered updates",
        description: "Status lives in too many places",
        sourceIds: ["source_1"],
      },
    ],
    workflows: [
      {
        id: "workflow_1",
        name: "Set a schedule",
        steps: ["Choose a cadence", "Pick recipients"],
        sourceIds: ["source_1"],
      },
    ],
    claims: [
      {
        id: "claim_1",
        text: "The dashboard shows a next run time for every export",
        sourceIds: ["source_2"],
      },
    ],
    audienceSignals: [
      {
        id: "audience_1",
        segment: "Engineering leads",
        description: "They report progress weekly",
        sourceIds: ["source_2"],
      },
    ],
    ...overrides,
  };
}

export function brandContext(
  overrides: Partial<WritingBrandContext> = {},
): WritingBrandContext {
  return {
    name: "Northwind Analytics",
    tagline: "Delivery status without the meetings",
    valueProposition: "a single source of truth for delivery status",
    positioning: "for regulated engineering teams",
    voiceSummary: "Plain and direct",
    preferredTerms: ["single source of truth"],
    prohibitedTerms: ["revolutionary"],
    voiceSignals: ["plain", "direct"],
    guidelines: [{ title: "Voice", detail: "Plain and direct" }],
    version: 1,
    ...overrides,
  };
}

/**
 * A context built the same way production builds one: facts are derived from the
 * product via `buildFacts`, so a test can never assert against a fact the engine
 * would not actually produce.
 */
export function makeContext(
  overrides: Partial<WritingContext> = {},
): WritingContext {
  const product = overrides.product ?? productContext();
  const sourceIds = overrides.sourceIds ?? ["source_1", "source_2"];
  return {
    projectId: "project_1",
    blockType: "HEADLINE",
    objective: "AWARENESS",
    tone: "BRAND",
    length: "MEDIUM",
    audience: null,
    language: null,
    userRequest: "Announce our scheduling tool",
    product,
    brand: overrides.brand ?? brandContext(),
    intent: null,
    direction: null,
    scene: null,
    sourceIds,
    facts: overrides.facts ?? buildFacts(product, new Set(sourceIds)),
    brandVersion: 1,
    intelligenceVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
