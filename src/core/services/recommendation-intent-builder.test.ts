import { describe, expect, it } from "vitest";
import { buildIntentDraft } from "./recommendation-intent-builder";
import type { ContentOpportunity } from "../domain/content-opportunity";
import type { RecommendationContext } from "../domain/recommendation-context";
import type { BrandRepository } from "../ports/brand-repository";
import type { ContentIntentRepository } from "../ports/content-intent-repository";
import type { IntelligenceRepository } from "../ports/intelligence-repository";
import { ContentIntentService } from "./content-intent-service";
import { ContentIntentValidator } from "./content-intent-validator";
import type { ContentIntent } from "../domain/content-intent";
import { createId } from "../../lib/id";

/**
 * The bridge is only worth having if CP09's real parser reads the request this
 * module writes. A unit test on the draft string alone would pass while every
 * actual selection produced an unresolved intent, so these tests resolve the
 * draft through CP09 itself.
 */

const PROJECT_ID = "project-1";
const USER_ID = "user-1";

class InMemoryIntentRepository implements ContentIntentRepository {
  rows = new Map<string, ContentIntent>();

  async create(intent: ContentIntent): Promise<ContentIntent> {
    const stored = { ...intent, id: intent.id || createId("intent") };
    this.rows.set(stored.id, stored);
    return stored;
  }

  async getById(id: string): Promise<ContentIntent | null> {
    return this.rows.get(id) ?? null;
  }

  async listForProject(projectId: string): Promise<ContentIntent[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId);
  }

  async update(intent: ContentIntent): Promise<ContentIntent> {
    this.rows.set(intent.id, intent);
    return intent;
  }
}

function intelligence(): Partial<IntelligenceRepository> {
  return {
    latestSnapshot: async () => ({ version: 3 }) as never,
    listFeatures: async () => [
      { id: "feature-analytics", name: "Analytics" },
      { id: "feature-integrations", name: "Integrations" },
    ] as never,
    listWorkflows: async () => [
      { id: "workflow-launch", name: "Launch Workflow" },
    ] as never,
    listProblems: async () => [
      { id: "problem-briefs", name: "Repetitive briefs" },
    ] as never,
    listBenefits: async () => [
      { id: "benefit-time", name: "Less repetitive work" },
    ] as never,
    getProduct: async () => ({ id: "product-1", name: "Content OS" }) as never,
  };
}

function contextFor(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    projectId: PROJECT_ID,
    product: {
      name: "Content OS",
      description: null,
      confidence: 90,
      category: null,
      valueProposition: null,
      sourceIds: ["src-product"],
      evidenceIds: [],
    },
    brand: null,
    features: [
      { id: "feature-analytics", name: "Analytics", description: null, category: "ANALYTICS", importance: "PRIMARY", confidence: 90, sourceIds: [], evidenceIds: ["ev-1"] },
      { id: "feature-integrations", name: "Integrations", description: null, category: "INTEGRATION", importance: "SECONDARY", confidence: 80, sourceIds: [], evidenceIds: ["ev-2"] },
    ],
    workflows: [
      { id: "workflow-launch", name: "Launch Workflow", description: null, steps: ["Draft"], featureIds: ["feature-analytics"], confidence: 90, sourceIds: [], evidenceIds: ["ev-3"] },
    ],
    problems: [
      { id: "problem-briefs", name: "Repetitive briefs", description: null, confidence: 90, sourceIds: [], evidenceIds: ["ev-4"] },
    ],
    benefits: [
      { id: "benefit-time", name: "Less repetitive work", description: null, confidence: 80, sourceIds: [], evidenceIds: ["ev-5"] },
    ],
    claims: [],
    assets: [],
    audienceSignals: [],
    existingContent: [],
    channelsUsed: ["VIDEO", "IMAGE", "TEXT"],
    availablePlatforms: ["youtube", "linkedin", "instagram", "tiktok", "x"],
    platformPriority: {},
    ...overrides,
  };
}

function opportunityFor(overrides: Partial<ContentOpportunity>): ContentOpportunity {
  return {
    id: "rec-1",
    key: "video.product_demo|FEATURE|id:feature-analytics|linkedin",
    projectId: PROJECT_ID,
    templateId: "feature_demo",
    contentTypeId: "video.product_demo",
    channel: "VIDEO",
    platform: "linkedin",
    subjectType: "FEATURE",
    subjectId: "feature-analytics",
    subjectLabel: "Analytics",
    title: "Demo the Analytics feature",
    rationale: "Proves the capability.",
    reasons: ["This feature has no content yet."],
    missingInputs: [],
    priorityScore: 80,
    evidence: { sourceIds: ["src-analytics"], evidenceIds: ["ev-1"], entityIds: [] },
    status: "ACTIVE",
    selectedIntentId: null,
    dismissedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function resolveDraft(draft: string): Promise<ContentIntent> {
  const service = new ContentIntentService({
    projectService: {
      getAuthorized: async () => ({ id: PROJECT_ID }) as never,
    } as never,
    repository: new InMemoryIntentRepository(),
    validator: new ContentIntentValidator(),
    brand: null as unknown as BrandRepository,
    intelligence: intelligence() as IntelligenceRepository,
    interpretationProvider: null,
  });

  const resolved = await service.resolve({
    projectId: PROJECT_ID,
    userId: USER_ID,
    request: draft,
  });

  return resolved.intent;
}

describe("buildIntentDraft", () => {
  it("drafts a request CP09 resolves to the same content type", async () => {
    const draft = buildIntentDraft(opportunityFor({}), contextFor());

    const intent = await resolveDraft(draft.request);

    expect(intent.contentTypeId).toBe("video.product_demo");
  });

  it("resolves the subject to the real feature id, not free text", async () => {
    const draft = buildIntentDraft(
      opportunityFor({ subjectId: "feature-analytics", subjectLabel: "Analytics" }),
      contextFor(),
    );

    const intent = await resolveDraft(draft.request);

    expect(intent.subjects).toContainEqual({ type: "FEATURE", id: "feature-analytics" });
  });

  it.each([
    ["image.carousel", "IMAGE", "workflow_carousel", "linkedin", { subjectType: "WORKFLOW", subjectId: "workflow-launch", subjectLabel: "Launch Workflow" }],
    ["text.linkedin", "TEXT", "linkedin_post", "linkedin", { subjectType: "FEATURE", subjectId: "feature-analytics", subjectLabel: "Analytics" }],
    ["text.x", "TEXT", "x_post", "x", { subjectType: "FEATURE", subjectId: "feature-analytics", subjectLabel: "Analytics" }],
    ["video.explainer", "VIDEO", "explainer", "youtube", { subjectType: "PROBLEM", subjectId: "problem-briefs", subjectLabel: "Repetitive briefs" }],
    ["video.launch", "VIDEO", "feature_launch", "linkedin", { subjectType: "FEATURE", subjectId: "feature-integrations", subjectLabel: "Integrations" }],
  ] as const)(
    "round-trips %s through CP09 with its subject linked",
    async (contentTypeId, channel, templateId, platform, subject) => {
      const opportunity = opportunityFor({
        contentTypeId,
        channel,
        templateId,
        platform,
        ...subject,
      });

      const draft = buildIntentDraft(opportunity, contextFor());
      const intent = await resolveDraft(draft.request);

      expect(intent.contentTypeId).toBe(contentTypeId);
      expect(intent.subjects.length).toBeGreaterThan(0);
      expect(intent.platforms.length).toBeGreaterThan(0);
    },
  );

  it("resolves a product-subject opportunity to the project's product", async () => {
    const opportunity = opportunityFor({
      templateId: "product_demo",
      contentTypeId: "video.product_demo",
      subjectType: "PRODUCT",
      subjectId: null,
      subjectLabel: "Content OS",
      platform: "youtube",
    });

    const draft = buildIntentDraft(opportunity, contextFor());
    const intent = await resolveDraft(draft.request);

    expect(intent.contentTypeId).toBe("video.product_demo");
    expect(intent.subjects).toContainEqual({ type: "PRODUCT", id: "product-1" });
  });

  it("carries a duration only for content types that support one", async () => {
    const video = buildIntentDraft(opportunityFor({}), contextFor());
    const carousel = buildIntentDraft(
      opportunityFor({
        contentTypeId: "image.carousel",
        channel: "IMAGE",
        templateId: "workflow_carousel",
        platform: "linkedin",
        subjectType: "WORKFLOW",
        subjectId: "workflow-launch",
        subjectLabel: "Launch Workflow",
      }),
      contextFor(),
    );

    expect(video.request).toContain("seconds");
    expect(carousel.request).not.toContain("seconds");
  });

  it("includes the audience segment when the project has one", () => {
    const draft = buildIntentDraft(
      opportunityFor({}),
      contextFor({
        audienceSignals: [
          { id: "aud-1", segment: "product marketers", description: null, confidence: 90 },
        ],
      }),
    );

    expect(draft.request).toContain("product marketers");
  });
});
