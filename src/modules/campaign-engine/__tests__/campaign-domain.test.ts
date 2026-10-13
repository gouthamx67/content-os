import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_LIMITS,
  type CampaignDeliverableRecord,
  type CampaignPlan,
  type CampaignRecord,
  type LaunchStrategy,
} from "../domain/types";
import { emptyDeliverableLinks } from "../domain/types";
import {
  allowedActions,
  assertAction,
  canPerform,
  isMaterialChange,
  statusAfterChange,
} from "../domain/lifecycle";
import {
  allowedPlatforms,
  platformDisplayName,
  resolveFormat,
} from "../domain/channels";
import {
  assertSchedulable,
  findScheduleConflicts,
  orderDeliverables,
  parseScheduleInstant,
} from "../domain/schedule";
import { evaluateReadiness, type LinkResolution } from "../domain/readiness";
import { buildLaunchKit, toExportDocument } from "../domain/launch-kit";
import {
  campaignHash,
  parseStoredJson,
  serializeCampaignJson,
  sha256Hex,
} from "../serialization/canonical";
import {
  validateBrief,
  validateDeliverableBrief,
  validateHeadline,
} from "../domain/validation";
import { materializeProposal, type PlannerContext } from "../planner";
const NOW = "2026-01-01T00:00:00.000Z";

function strategy(): LaunchStrategy {
  return {
    positioning: "Northwind for regulated teams",
    keyMessage: "Ship content without a legal bottleneck",
    narrative: [{ id: "beat_1", title: "Hook", description: "Lead with proof" }],
    phases: [
      { id: "phase_1", name: "Launch", description: "Go live", startOffsetDays: 0, durationDays: 7 },
    ],
    platformIds: ["linkedin"],
    tone: "BRAND",
    groundedIn: { sourceIds: ["src_1"], intelligenceVersion: 1, brandVersion: 1 },
  };
}

function plan(): CampaignPlan {
  return {
    deliverables: [
      {
        key: "linkedin_0",
        title: "Launch post",
        channel: "TEXT",
        platformId: "linkedin",
        contentTypeId: "text.linkedin",
        objective: "Reach",
        keyMessage: "One promise",
        phaseId: "phase_1",
      },
    ],
    generatedAt: NOW,
    generatedBy: "DETERMINISTIC",
  };
}

function campaignRecord(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: "camp_1",
    projectId: "proj_1",
    name: "Launch",
    objective: "Drive sign-ups",
    audienceSummary: "Regulated teams",
    keyMessage: "Ship content without a legal bottleneck",
    brief: {
      tone: "BRAND",
      constraints: [],
      keyMessages: [],
      successMetrics: [],
      sourceIds: ["src_1"],
      launchWindow: null,
      notes: null,
    },
    status: "PLANNED",
    strategy: strategy(),
    plan: plan(),
    revisionNumber: 3,
    approvalHash: null,
    approvedById: null,
    approvedAt: null,
    launchKitHash: null,
    assembledAt: null,
    hasLaunchKit: false,
    createdById: "user_1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function deliverableRecord(
  overrides: Partial<CampaignDeliverableRecord> = {},
): CampaignDeliverableRecord {
  return {
    id: "del_1",
    campaignId: "camp_1",
    projectId: "proj_1",
    title: "Launch post",
    channel: "TEXT",
    platformId: "linkedin",
    contentTypeId: "text.linkedin",
    brief: { objective: "Reach", keyMessage: "One promise", notes: null, phaseId: "phase_1" },
    links: emptyDeliverableLinks(),
    position: 0,
    status: "PLANNED",
    scheduledFor: null,
    createdById: "user_1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("campaign canonical serialization", () => {
  it("hashes the same value to the same digest regardless of key order", () => {
    const a = campaignHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = campaignHash({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe(sha256Hex(serializeCampaignJson({ a: 1, b: 2, nested: { x: 1, y: 2 } })));
  });

  it("refuses to repair a stored value that is not an object", () => {
    expect(() => parseStoredJson("[1,2,3]", "brief")).toThrow();
    expect(() => parseStoredJson("not json", "brief")).toThrow();
    expect(parseStoredJson('{"a":1}', "brief")).toEqual({ a: 1 });
  });
});

describe("format resolution", () => {
  it("rejects an unknown platform", () => {
    expect(() =>
      resolveFormat({ platformId: "myspace", channel: "TEXT", projectPlatforms: [] }),
    ).toThrowError(/Unknown platform/);
  });

  it("rejects a platform the project does not plan around", () => {
    expect(() =>
      resolveFormat({
        platformId: "youtube",
        channel: "VIDEO",
        projectPlatforms: ["linkedin"],
      }),
    ).toThrowError(/not one of this project/);
  });

  it("rejects a channel the platform does not carry", () => {
    expect(() =>
      resolveFormat({ platformId: "email", channel: "VIDEO", projectPlatforms: [] }),
    ).toThrowError(/does not carry/);
  });

  it("rejects a content type that cannot publish to the platform", () => {
    expect(() =>
      resolveFormat({ platformId: "x", contentTypeId: "text.linkedin", projectPlatforms: [] }),
    ).toThrowError(/cannot be published/);
  });

  it("resolves a default content type when only a channel is given", () => {
    const resolved = resolveFormat({
      platformId: "linkedin",
      channel: "TEXT",
      projectPlatforms: [],
    });
    expect(resolved.channel).toBe("TEXT");
    expect(resolved.contentTypeId).toBe("text.linkedin");
    expect(resolved.platformName).toBe("LinkedIn");
  });

  it("treats an empty project platform list as registry-wide", () => {
    expect(allowedPlatforms([]).length).toBeGreaterThan(3);
    expect(allowedPlatforms(["linkedin"])).toEqual(["linkedin"]);
    expect(platformDisplayName("linkedin")).toBe("LinkedIn");
    expect(platformDisplayName("unknown")).toBe("unknown");
  });
});

describe("lifecycle graph", () => {
  it("allows only the documented transitions", () => {
    expect(allowedActions("DRAFT")).toContain("PLAN");
    expect(allowedActions("DRAFT")).not.toContain("SUBMIT");
    expect(canPerform("PLANNED", "SUBMIT")).toBe(true);
    expect(canPerform("DRAFT", "SUBMIT")).toBe(false);
    expect(canPerform("ARCHIVED", "EDIT")).toBe(false);
  });

  it("returns the resulting status or refuses", () => {
    expect(assertAction("DRAFT", "PLAN")).toBe("PLANNED");
    expect(assertAction("PLANNED", "SUBMIT")).toBe("IN_REVIEW");
    expect(assertAction("IN_REVIEW", "APPROVE")).toBe("APPROVED");
    expect(assertAction("PLANNED", "ARCHIVE")).toBe("ARCHIVED");
    expect(() => assertAction("DRAFT", "APPROVE")).toThrowError(/Cannot approve/);
  });

  it("knows which changes invalidate an approval", () => {
    expect(isMaterialChange("BRIEF_UPDATED")).toBe(true);
    expect(isMaterialChange("ASSEMBLED")).toBe(false);
    expect(isMaterialChange("SUBMITTED")).toBe(false);
    expect(statusAfterChange("APPROVED", true)).toBe("PLANNED");
    expect(statusAfterChange("APPROVED", false)).toBe("APPROVED");
    expect(statusAfterChange("PLANNED", true)).toBe("PLANNED");
  });
});

describe("schedule rules", () => {
  const brief = {
    tone: "BRAND" as const,
    constraints: [],
    keyMessages: [],
    successMetrics: [],
    sourceIds: [],
    launchWindow: { start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" },
    notes: null,
  };

  it("parses only finite instants", () => {
    expect(parseScheduleInstant("2026-11-15T00:00:00.000Z")).toBeGreaterThan(0);
    expect(parseScheduleInstant("not a date")).toBeNull();
  });

  it("keeps a scheduled time inside the window", () => {
    expect(assertSchedulable("2026-11-15T12:00:00.000Z", brief)).toBe(
      "2026-11-15T12:00:00.000Z",
    );
    expect(() => assertSchedulable("2026-10-01T00:00:00.000Z", brief)).toThrowError(
      /before the launch window/,
    );
    expect(() => assertSchedulable("2027-01-01T00:00:00.000Z", brief)).toThrowError(
      /after the launch window/,
    );
  });

  it("flags a same-platform same-instant double post", () => {
    const at = "2026-11-15T12:00:00.000Z";
    const conflicts = findScheduleConflicts([
      deliverableRecord({ id: "a", title: "A", scheduledFor: at }),
      deliverableRecord({ id: "b", title: "B", scheduledFor: at }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe("SCHEDULE_CONFLICT");
    expect(conflicts[0].severity).toBe("WARNING");
  });

  it("orders scheduled deliverables before unscheduled ones", () => {
    const ordered = orderDeliverables([
      deliverableRecord({ id: "later", scheduledFor: "2026-11-20T00:00:00.000Z", position: 0 }),
      deliverableRecord({ id: "unscheduled", scheduledFor: null, position: 1 }),
      deliverableRecord({ id: "earlier", scheduledFor: "2026-11-10T00:00:00.000Z", position: 2 }),
    ]);
    expect(ordered.map((d) => d.id)).toEqual(["earlier", "later", "unscheduled"]);
  });
});

describe("readiness validator", () => {
  const ready = () =>
    evaluateReadiness({
      campaign: campaignRecord(),
      deliverables: [deliverableRecord()],
      grounding: { missingSourceIds: [] },
      links: [],
    });

  it("is ready when strategy, plan, grounding and deliverables line up", () => {
    const result = ready();
    expect(result.ready).toBe(true);
    expect(result.summary.blocking).toBe(0);
    expect(result.checks.map((c) => c.code)).toContain("SUMMARY");
  });

  it("blocks a campaign with no strategy or plan", () => {
    const result = evaluateReadiness({
      campaign: campaignRecord({ strategy: null, plan: null }),
      deliverables: [],
      grounding: { missingSourceIds: [] },
      links: [],
    });
    expect(result.ready).toBe(false);
    const codes = result.checks.map((c) => c.code);
    expect(codes).toContain("STRATEGY_MISSING");
    expect(codes).toContain("PLAN_MISSING");
  });

  it("blocks a deliverable marked blocked", () => {
    const result = evaluateReadiness({
      campaign: campaignRecord(),
      deliverables: [deliverableRecord({ status: "BLOCKED" })],
      grounding: { missingSourceIds: [] },
      links: [],
    });
    expect(result.ready).toBe(false);
    expect(result.checks.map((c) => c.code)).toContain("DELIVERABLE_BLOCKED");
  });

  it("blocks a link to an artifact from another project", () => {
    const link: LinkResolution = {
      deliverableId: "del_1",
      missing: [],
      crossProject: [{ kind: "writing", id: "wdoc_foreign" }],
      requiredAssets: 0,
      readyAssets: 0,
    };
    const result = evaluateReadiness({
      campaign: campaignRecord(),
      deliverables: [deliverableRecord()],
      grounding: { missingSourceIds: [] },
      links: [link],
    });
    expect(result.ready).toBe(false);
    expect(result.checks.map((c) => c.code)).toContain(
      "LINKED_ARTIFACT_CROSS_PROJECT",
    );
  });

  it("warns rather than blocks for an unscheduled deliverable", () => {
    const result = ready();
    expect(result.checks.some((c) => c.code === "DELIVERABLE_UNSCHEDULED")).toBe(true);
    expect(result.checks.find((c) => c.code === "DELIVERABLE_UNSCHEDULED")?.severity).toBe(
      "WARNING",
    );
  });
});

describe("launch kit", () => {
  function build(assembledAt: string, objective = "Drive sign-ups") {
    const campaign = campaignRecord({ objective });
    const deliverables = [
      deliverableRecord({
        scheduledFor: "2026-11-15T12:00:00.000Z",
      }),
    ];
    const readiness = evaluateReadiness({
      campaign,
      deliverables,
      grounding: { missingSourceIds: [] },
      links: [],
    });
    return buildLaunchKit({
      campaign,
      deliverables,
      readiness,
      copy: new Map([["del_1", { documentId: "wdoc_1", title: "Post", content: "Hello" }]]),
      assets: new Map(),
      assembledAt,
    });
  }

  it("hashes the same kit the same way regardless of assembly time", () => {
    const a = build("2026-01-01T00:00:00.000Z");
    const b = build("2026-06-01T00:00:00.000Z");
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when the campaign materially changes", () => {
    expect(build(NOW).hash).not.toBe(build(NOW, "A different objective").hash);
  });

  it("refuses to export a kit carrying a filesystem path or a secret", () => {
    const pathy = build(NOW, "See /home/team/notes.txt");
    expect(() => toExportDocument(pathy.kit)).toThrowError(/filesystem path/);

    const secret = build(NOW, "api_key: abc123");
    expect(() => toExportDocument(secret.kit)).toThrowError(/secret-looking/);
  });

  it("exports a schema-tagged document", () => {
    const document = toExportDocument(build(NOW).kit);
    expect(document["schema"]).toBe("content-os.campaign-launch-kit");
    expect(document["version"]).toBe(1);
  });
});

describe("validation", () => {
  it("requires every headline field", () => {
    expect(() =>
      validateHeadline({ name: " ", objective: "x", audienceSummary: "x", keyMessage: "x" }),
    ).toThrowError(/Campaign name is required/);
    const headline = validateHeadline({
      name: "Launch",
      objective: "Ship",
      audienceSummary: "Teams",
      keyMessage: "Faster",
    });
    expect(headline.name).toBe("Launch");
  });

  it("defaults an empty brief and validates the launch window", () => {
    const brief = validateBrief(undefined);
    expect(brief.tone).toBe("BRAND");
    expect(brief.sourceIds).toEqual([]);
    expect(brief.launchWindow).toBeNull();
    expect(() =>
      validateBrief({ launchWindow: { start: "2026-01-02", end: "2026-01-01" } }),
    ).toThrowError(/end after it starts/);
  });

  it("limits the number of deliverables", () => {
    expect(CAMPAIGN_LIMITS.maxDeliverables).toBeGreaterThan(0);
    expect(validateDeliverableBrief({ objective: "Reach", keyMessage: "Now" })).toEqual({
      objective: "Reach",
      keyMessage: "Now",
      notes: null,
      phaseId: null,
    });
    expect(() => validateDeliverableBrief({ keyMessage: "x" })).toThrowError(
      /Deliverable objective/,
    );
  });
});

describe("planner", () => {
  const context: PlannerContext = {
    campaignName: "Launch",
    objective: "Drive sign-ups",
    audienceSummary: "Regulated teams",
    keyMessage: "Ship content without a legal bottleneck",
    tone: "BRAND",
    launchWindow: null,
    projectPlatforms: [],
    grounding: { sourceIds: ["src_1"], intelligenceVersion: 1, brandVersion: 1 },
    newId: (prefix) => `${prefix}_1`,
    now: () => NOW,
  };

  it("refuses an AI proposal that cites no grounding source", () => {
    expect(() =>
      materializeProposal(context, {
        source: "AI",
        positioning: "Something",
        keyMessage: "Something",
        tone: "BRAND",
        narrative: [],
        phases: [],
        platformIds: ["linkedin"],
        deliverables: [
          {
            key: "k",
            title: "Post",
            platformId: "linkedin",
            channel: "TEXT",
            phaseIndex: null,
            objective: "Reach",
            keyMessage: "Now",
          },
        ],
        groundedInSourceIds: [],
      }),
    ).toThrowError(/must cite at least one grounding source/);
  });

  it("materialises a deterministic plan with resolvable formats", () => {
    const { strategy: built, plan: builtPlan } = materializeProposal(context, undefined);
    expect(built.platformIds.length).toBeGreaterThan(0);
    expect(builtPlan.generatedBy).toBe("DETERMINISTIC");
    expect(builtPlan.deliverables.length).toBeGreaterThan(0);
    for (const deliverable of builtPlan.deliverables) {
      expect(deliverable.contentTypeId).toBeTruthy();
      expect(deliverable.platformId).toBeTruthy();
    }
  });

  it("refuses a plan that targets an unknown platform", () => {
    expect(() =>
      materializeProposal(context, {
        source: "DETERMINISTIC",
        positioning: "Something",
        keyMessage: "Something",
        tone: "BRAND",
        narrative: [],
        phases: [],
        platformIds: ["myspace"],
        deliverables: [],
        groundedInSourceIds: [],
      }),
    ).toThrowError(/Unknown platform/);
  });
});
