import { describe, expect, it } from "vitest";
import {
  FakeCreativeDirectionRepository,
  makeCreativeContext,
  makeCreativeDirection,
} from "../../testing/fakes";
import type { ContentIntent } from "../domain/content-intent";
import { CreativeError } from "../domain/creative-direction";
import type { CreativeDirectionDraft } from "../domain/creative-direction";
import type { CreativeDirector } from "../ports/creative-director";
import type { IntelligenceGraph, IntelligenceSnapshot } from "../domain/intelligence";
import type { BrandProfile } from "../domain/brand";
import { CreativeDirectorService } from "./creative-director-service";
import { DeterministicCreativeDirector } from "./deterministic-creative-director";
import {
  CREATIVE_STYLES,
  draftFromStyle,
  type CreativeStyleId,
} from "../domain/creative-style";
import { factsFromContext } from "./deterministic-creative-director";
import { getCreativeModePolicy } from "./creative-mode-policy";

const intent: ContentIntent = {
  id: "int_1",
  projectId: "prj_1",
  rawRequest: "Make a 30 second launch video for LinkedIn",
  channel: "VIDEO",
  contentTypeId: "product-launch-video",
  platforms: ["linkedin"],
  subjects: [{ type: "PRODUCT", id: "prod_1" }],
  audience: "engineering leads",
  language: "en",
  tone: "direct",
  cta: "Start free trial",
  durationSeconds: 30,
  quantity: 1,
  aspectRatio: "16:9",
  constraints: [{ key: "duration", value: "30", source: "USER" }],
  resolutionMode: "EXPLICIT",
  status: "RESOLVED",
  confidence: "HIGH",
  unresolvedFields: [],
  notes: [],
  sourceIds: [],
  brandVersion: 3,
  intelligenceSnapshotVersion: 7,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const graph: IntelligenceGraph = {
  product: {
    id: "prod_1",
    projectId: "prj_1",
    name: "Loomly",
    shortDescription: "A scheduling tool",
    longDescription: null,
    category: null,
    purpose: null,
    valueProposition: "Ship updates without chasing",
    targetUserSummary: "engineering leads",
    confidence: "HIGH",
    assertionKind: "FACT",
    userLocked: false,
    provenance: null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  },
  workflows: [
    {
      id: "wf_1",
      projectId: "prj_1",
      name: "Set up a scheduled export",
      description: "Get a report going on a cadence",
      steps: [
        {
          id: "wfs_1",
          workflowId: "wf_1",
          order: 0,
          action: "Pick a report",
          description: null,
          featureIds: ["feat_1"],
        },
        {
          id: "wfs_2",
          workflowId: "wf_1",
          order: 1,
          action: "Pick a cadence",
          description: null,
          featureIds: [],
        },
      ],
      featureIds: ["feat_1"],
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "setup-export",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  problems: [
    {
      id: "prb_1",
      projectId: "prj_1",
      name: "Chasing people for updates",
      description: "Engineers spend Friday afternoons chasing status",
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "chasing-updates",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  benefits: [
    {
      id: "ben_1",
      projectId: "prj_1",
      name: "One place for status",
      description: "The team reads one scheduled report instead of asking",
      linkedFeatureIds: ["feat_1"],
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "one-place-for-status",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  features: [
    {
      id: "feat_1",
      projectId: "prj_1",
      name: "Scheduled exports",
      description: "Send a status report on a fixed schedule",
      category: "AUTOMATION",
      importance: "PRIMARY",
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "scheduled-exports",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  claims: [
    {
      id: "cl_1",
      projectId: "prj_1",
      text: "Exports run on a schedule",
      claimType: "PERFORMANCE",
      sourceId: "src_1",
      verification: "SUPPORTED",
      conflictsWithClaimId: null,
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "exports-scheduled",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  evidence: [],
  audienceSignals: [],
  brandSignals: [],
  assets: [
    {
      id: "as_1",
      projectId: "prj_1",
      sourceId: "src_1",
      name: "Schedule screen",
      mediaType: "PRODUCT_UI",
      role: "PRODUCT_UI",
      storageKey: null,
      mimeType: null,
      width: null,
      height: null,
      durationMs: null,
      qualitySignals: null,
      relatedFeatureIds: [],
      relatedClaimIds: [],
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "schedule-screen",
      provenance: null,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    },
  ],
  relationships: [
    {
      id: "rel_1",
      projectId: "prj_1",
      type: "CLAIM_SUPPORTED_BY_EVIDENCE",
      fromType: "CLAIM",
      fromId: "cl_1",
      toType: "EVIDENCE",
      toId: "ev_1",
      confidence: "HIGH",
      createdAt: intent.createdAt,
    },
  ],
};

const snapshot = { version: 7 } as unknown as IntelligenceSnapshot;

function makeService(
  directors: CreativeDirector[] = [new DeterministicCreativeDirector()],
  overrides: {
    intent?: ContentIntent;
    graph?: IntelligenceGraph;
    brand?: BrandProfile | null;
  } = {},
) {
  const repository = new FakeCreativeDirectionRepository();
  let counter = 0;
  let tick = 0;

  const service = new CreativeDirectorService({
    projectService: {
      getAuthorized: async (projectId: string, userId: string) => {
        if (userId !== "usr_1") {
          throw new Error("not authorised");
        }
        return { id: projectId } as never;
      },
    },
    intentRepository: {
      getById: async () => overrides.intent ?? intent,
    },
    repository,
    intelligenceRepository: {
      readGraph: async () => overrides.graph ?? graph,
      latestSnapshot: async () => snapshot,
    },
    brandRepository: {
      getByProjectId: async () => overrides.brand ?? null,
    },
    assetRepository: {
      listByProject: async () => [],
    },
    directors,
    createId: (prefix) => `${prefix}_${++counter}`,
    // A clock that moves, so a test can tell a rewrite from an untouched row.
    now: () => new Date(Date.UTC(2026, 8, 29, 10, 0, tick++)),
  });

  return { service, repository };
}

/** A director that returns one hand-written draft, for the AI-path tests. */
function fixedDirector(
  drafts: CreativeDirectionDraft[],
  id = "ai-creative-director",
): CreativeDirector {
  return {
    id,
    generate: async () => ({
      provider: id,
      model: "test-model",
      proposals: drafts.map((draft, index) => ({
        id: `p${index}`,
        name: draft.name,
        description: "fixed",
        draft,
      })),
    }),
  };
}

function draftFor(styleId: CreativeStyleId) {
  const context = makeCreativeContext();
  return draftFromStyle(CREATIVE_STYLES[styleId], factsFromContext(context), {
    claimIds: ["cl_1"],
    evidenceIds: [],
    cta: "Start free trial",
  });
}

describe("creative director service", () => {
  it("generates three to five validated directions in one run", async () => {
    const { service, repository } = makeService();
    const result = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    expect(result.directions.length).toBeGreaterThanOrEqual(3);
    expect(result.directions.length).toBeLessThanOrEqual(5);
    expect(new Set(result.directions.map((d) => d.creativeRunId)).size).toBe(1);
    expect(repository.directions.size).toBe(result.directions.length);

    for (const direction of result.directions) {
      expect(direction.status).toBe("DRAFT");
      expect(direction.mode).toBe("BALANCED");
      expect(direction.strengthScore).toBeGreaterThan(0);
      expect(direction.brandVersion).toBe(3);
      expect(direction.intelligenceVersion).toBe(7);
    }
  });

  it("clamps the requested count into the useful range", async () => {
    const { service } = makeService();
    const tooFew = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
      count: 1,
    });
    expect(tooFew.directions).toHaveLength(3);

    const tooMany = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
      count: 50,
    });
    expect(tooMany.directions).toHaveLength(5);
  });

  it("refuses a mode it does not have", async () => {
    const { service } = makeService();
    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: "int_1",
        mode: "RECKLESS",
      }),
    ).rejects.toThrow(CreativeError);
  });

  it("will not generate for an unresolved request", async () => {
    const { service } = makeService(undefined, {
      intent: { ...intent, status: "DRAFT" },
    });
    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: "int_1",
        mode: "BALANCED",
      }),
    ).rejects.toThrow(/Resolve the content request/);
  });

  it("refuses to run Guided mode on a project with no product UI", async () => {
    const { service } = makeService(undefined, {
      graph: { ...graph, assets: [] },
    });
    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: "int_1",
        mode: "GUIDED",
      }),
    ).rejects.toThrow(/needs captured product UI/);
  });

  it("keeps a previous run rather than replacing it", async () => {
    const { service, repository } = makeService();
    const first = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });
    const second = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    expect(second.creativeRunId).not.toBe(first.creativeRunId);
    expect(repository.directions.size).toBe(
      first.directions.length + second.directions.length,
    );

    // Nothing from the first run was touched.
    for (const original of first.directions) {
      const stored = await repository.getById(original.id);
      expect(stored?.updatedAt).toBe(original.updatedAt);
      expect(stored?.status).toBe("DRAFT");
    }
  });

  it("uses a model director when one is configured", async () => {
    const director = fixedDirector([
      draftFor("PRODUCT_FIRST"),
      draftFor("SOCIAL"),
      draftFor("TECHNICAL"),
    ]);
    const { service } = makeService([director, new DeterministicCreativeDirector()]);

    const result = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    expect(result.provider).toBe("ai-creative-director");
    expect(result.model).toBe("test-model");
    expect(result.fallbackFrom).toBeNull();
  });

  it("falls back to the deterministic director when a model fails", async () => {
    const failing: CreativeDirector = {
      id: "ai-creative-director",
      generate: async () => {
        throw new Error("provider is down");
      },
    };
    const { service } = makeService([failing, new DeterministicCreativeDirector()]);

    const result = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    expect(result.provider).toBe("deterministic-creative-director");
    expect(result.fallbackFrom).toBe("ai-creative-director");
    expect(result.fallbackReason).toBe("provider is down");
    expect(result.directions.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a model direction that cites a claim the project lacks", async () => {
    const bad = {
      ...draftFor("PRODUCT_FIRST"),
      proofStrategy: {
        claimIds: ["cl_fabricated"],
        evidenceIds: [],
        proofPoints: ["Show the dashboard"],
      },
    };
    const director = fixedDirector([bad, draftFor("SOCIAL"), draftFor("TECHNICAL")]);
    const { service, repository } = makeService([
      director,
      new DeterministicCreativeDirector(),
    ]);

    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: "int_1",
        mode: "BALANCED",
      }),
    ).rejects.toThrow();
    expect(repository.directions.size).toBe(0);
  });

  it("marks a user edit and revalidates it against the same rules", async () => {
    const { service } = makeService();
    const generated = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });
    const target = generated.directions[0];

    const updated = await service.update({
      projectId: "prj_1",
      userId: "usr_1",
      directionId: target.id,
      patch: { thesis: "Chasing status is the thing this removes" },
    });

    expect(updated.editedByUser).toBe(true);
    expect(updated.thesis).toBe("Chasing status is the thing this removes");
    expect(updated.updatedAt).not.toBe(target.updatedAt);
  });

  it("will not store a user edit that fabricates a number", async () => {
    const { service } = makeService();
    const generated = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    await expect(
      service.update({
        projectId: "prj_1",
        userId: "usr_1",
        directionId: generated.directions[0].id,
        patch: { thesis: "Teams ship 10x faster with Loomly" },
      }),
    ).rejects.toThrow();
  });

  it("keeps exactly one selected direction per intent", async () => {
    const { service } = makeService();
    const generated = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });

    const first = await service.select("prj_1", "usr_1", generated.directions[0].id);
    expect(first.selected.status).toBe("SELECTED");

    const second = await service.select("prj_1", "usr_1", generated.directions[1].id);
    expect(second.selected.status).toBe("SELECTED");
    expect(second.demoted.map((d) => d.id)).toEqual([generated.directions[0].id]);

    const all = await service.list("prj_1", "usr_1", { intentId: "int_1" });
    expect(all.filter((d) => d.status === "SELECTED")).toHaveLength(1);
  });

  it("does not touch other intents when selecting", async () => {
    const { service, repository } = makeService();
    const first = await service.generate({
      projectId: "prj_1",
      userId: "usr_1",
      intentId: "int_1",
      mode: "BALANCED",
    });
    await service.select("prj_1", "usr_1", first.directions[0].id);

    await repository.create(
      makeCreativeDirection({ intentId: "int_2", status: "SELECTED" }),
    );

    await service.select("prj_1", "usr_1", first.directions[1].id);
    const other = await repository.listByIntent("int_2");
    expect(other.filter((d) => d.status === "SELECTED")).toHaveLength(1);
  });

  it("refuses a direction belonging to another project", async () => {
    const { service, repository } = makeService();
    await repository.create(makeCreativeDirection({ projectId: "prj_2" }));

    await expect(
      service.get("prj_1", "usr_1", [...repository.directions.values()][0].id),
    ).rejects.toThrow(/not found/i);
  });

  it("checks the caller before reading anything", async () => {
    const { service } = makeService();
    await expect(
      service.list("prj_1", "usr_2"),
    ).rejects.toThrow();
  });

  it("builds a context that carries the mode's own policy", async () => {
    const { service } = makeService();
    const context = await service.buildContext("prj_1", "usr_1", "int_1", "GUIDED");

    expect(context.mode).toBe("GUIDED");
    expect(context.policy).toEqual(getCreativeModePolicy("GUIDED"));
    expect(context.intent.cta).toBe("Start free trial");
    expect(context.intent.durationSeconds).toBe(30);
    expect(context.product.claims[0].verification).toBe("SUPPORTED");
    expect(context.assets[0].isProductUi).toBe(true);
  });
});

describe("creative director service: a project with nothing to stand on", () => {
  it("refuses explicitly instead of answering with an empty list", async () => {
    // No features, problems, benefits or workflows were ever recorded, so there
    // is no honest direction to build. An empty array would look like a bug in
    // the panel; a named refusal tells the user what to go and fix.
    const empty: IntelligenceGraph = {
      ...graph,
      features: [],
      problems: [],
      benefits: [],
      workflows: [],
    };
    const { service } = makeService(undefined, { graph: empty });

    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: intent.id,
        mode: "BALANCED",
        count: 3,
      }),
    ).rejects.toMatchObject({ code: "CREATIVE_INSUFFICIENT_CONTEXT" });
  });

  it("writes nothing when it refuses", async () => {
    const empty: IntelligenceGraph = {
      ...graph,
      features: [],
      problems: [],
      benefits: [],
      workflows: [],
    };
    const { service, repository } = makeService(undefined, { graph: empty });

    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_1",
        intentId: intent.id,
        mode: "BALANCED",
        count: 3,
      }),
    ).rejects.toBeInstanceOf(CreativeError);

    expect(await repository.listByIntent(intent.id)).toEqual([]);
  });
});
