import { describe, expect, it } from "vitest";
import { PublicationSourceResolver } from "../source-resolver";
import { hashPublishableSnapshot } from "../serialization";
import type { WritingRepository } from "../../../core/ports/writing-repository";
import type { CampaignRepository } from "../../../core/ports/campaign-repository";
import type {
  ClaimStatus,
  WritingDocumentRecord,
} from "../../writing-engine/domain/types";

function document(overrides: Partial<WritingDocumentRecord> = {}): WritingDocumentRecord {
  return {
    id: "doc-1",
    projectId: "p1",
    createdById: "u1",
    title: "Launch headline",
    blockType: "BODY",
    tone: "BRAND",
    length: "MEDIUM",
    objective: "AWARENESS",
    audience: null,
    language: "en",
    content: "We ship on Friday.",
    contentSha256: "hash",
    contextSnapshot: "{}",
    contextSha256: "hash",
    version: 2,
    brandVersion: null,
    intelligenceVersion: null,
    intentId: null,
    directionId: null,
    storyboardId: null,
    sceneId: null,
    selectedVariantId: null,
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    ...overrides,
  };
}

function writingRepo(options: {
  document?: WritingDocumentRecord | null;
  claims?: { status: ClaimStatus }[];
}): WritingRepository {
  return {
    getDocument: async () => options.document ?? null,
    listClaims: async () => options.claims ?? [],
  } as unknown as WritingRepository;
}

function campaignRepo(options: {
  campaign?: Record<string, unknown> | null;
  deliverable?: Record<string, unknown> | null;
}): CampaignRepository {
  return {
    getCampaign: async () => options.campaign ?? null,
    getDeliverableForProject: async () => options.deliverable ?? null,
  } as unknown as CampaignRepository;
}

function approvedCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    projectId: "p1",
    name: "Fall launch",
    status: "APPROVED",
    revisionNumber: 3,
    approvedAt: "2026-10-16T09:00:00.000Z",
    ...overrides,
  };
}

function readyDeliverable(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    campaignId: "c1",
    projectId: "p1",
    title: "Announcement post",
    status: "READY",
    links: {
      intentId: null,
      writingDocumentId: "doc-1",
      adaptationBatchId: null,
      editorDocumentId: null,
      graphicDocumentId: null,
      assetIds: [],
      sourceIds: [],
    },
    ...overrides,
  };
}

describe("PublicationSourceResolver", () => {
  it("freezes a writing document with a stable content hash and a grounding warning", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({ document: document(), claims: [] }),
      campaigns: campaignRepo({}),
    });

    const resolution = await resolver.resolve("p1", "WRITING_DOCUMENT", "doc-1");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source.sourceRevision).toBe("v2");
    expect(
      resolution.source.snapshot.contentSha256,
    ).toBe(
      hashPublishableSnapshot({
        title: "Launch headline",
        content: "We ship on Friday.",
      }),
    );
    expect(resolution.source.findings).toHaveLength(1);
    expect(resolution.source.findings[0]?.code).toBe(
      "SOURCE_GROUNDING_NOT_EVALUATED",
    );
    expect(resolution.source.findings[0]?.severity).toBe("WARNING");
  });

  it("raises a blocking finding for unsupported and review-flagged claims", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({
        document: document(),
        claims: [{ status: "GROUNDED" }, { status: "UNSUPPORTED" }, { status: "REVIEW" }],
      }),
      campaigns: campaignRepo({}),
    });

    const resolution = await resolver.resolve("p1", "WRITING_DOCUMENT", "doc-1");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const findings = resolution.source.findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SOURCE_GROUNDING_UNSUPPORTED");
    expect(findings[0]?.severity).toBe("ERROR");
  });

  it("reports a missing document instead of an empty snapshot", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({ document: null }),
      campaigns: campaignRepo({}),
    });
    const resolution = await resolver.resolve("p1", "WRITING_DOCUMENT", "doc-x");
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.findings[0]?.code).toBe("SOURCE_NOT_FOUND");
  });

  it("resolves a campaign deliverable through its linked writing document", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({
        document: document(),
        claims: [{ status: "GROUNDED" }],
      }),
      campaigns: campaignRepo({
        campaign: approvedCampaign(),
        deliverable: readyDeliverable(),
      }),
    });

    const resolution = await resolver.resolve(
      "p1",
      "CAMPAIGN_DELIVERABLE",
      "d1",
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source.sourceId).toBe("d1");
    expect(resolution.source.sourceRevision).toBe("r3:v2");
    expect(resolution.source.snapshot.sourceLabel).toContain("Fall launch");
    expect(resolution.source.snapshot.approvalNote).toContain("r3");
    expect(resolution.source.findings).toEqual([]);
  });

  it("refuses a campaign that is not approved", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({ document: document() }),
      campaigns: campaignRepo({
        campaign: approvedCampaign({ status: "DRAFT" }),
        deliverable: readyDeliverable(),
      }),
    });
    const resolution = await resolver.resolve(
      "p1",
      "CAMPAIGN_DELIVERABLE",
      "d1",
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(
      resolution.findings.some(
        (finding) => finding.code === "SOURCE_NOT_APPROVED",
      ),
    ).toBe(true);
  });

  it("refuses a deliverable that is not ready", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({ document: document() }),
      campaigns: campaignRepo({
        campaign: approvedCampaign(),
        deliverable: readyDeliverable({ status: "IN_PROGRESS" }),
      }),
    });
    const resolution = await resolver.resolve(
      "p1",
      "CAMPAIGN_DELIVERABLE",
      "d1",
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(
      resolution.findings.some(
        (finding) =>
          finding.code === "SOURCE_NOT_APPROVED" &&
          finding.message.includes("IN_PROGRESS"),
      ),
    ).toBe(true);
  });

  it("refuses a deliverable with no linked writing document", async () => {
    const resolver = new PublicationSourceResolver({
      writing: writingRepo({ document: document() }),
      campaigns: campaignRepo({
        campaign: approvedCampaign(),
        deliverable: readyDeliverable({
          links: {
            intentId: null,
            writingDocumentId: null,
            adaptationBatchId: null,
            editorDocumentId: "edoc-1",
            graphicDocumentId: null,
            assetIds: [],
            sourceIds: [],
          },
        }),
      }),
    });
    const resolution = await resolver.resolve(
      "p1",
      "CAMPAIGN_DELIVERABLE",
      "d1",
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    const ambiguous = resolution.findings.find(
      (finding) => finding.code === "SOURCE_LINKS_AMBIGUOUS",
    );
    expect(ambiguous?.message).toContain("editor document");
  });
});
