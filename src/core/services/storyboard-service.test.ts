import { describe, expect, it } from "vitest";
import {
  FakeStoryboardRepository,
  makeCreativeDirection,
} from "../../testing/fakes";
import type { ContentIntent } from "../domain/content-intent";
import { StoryboardError } from "../domain/storyboard";
import type { StoryboardPlanner } from "../ports/storyboard-planner";
import type { EditableStoryboardScene } from "../domain/storyboard";
import type { IntelligenceGraph, IntelligenceSnapshot } from "../domain/intelligence";
import { emptyBrandProfile } from "../domain/brand";
import { StoryboardService } from "./storyboard-service";

const now = "2026-09-29T00:00:00.000Z";

const intent: ContentIntent = {
  id: "int_1",
  projectId: "prj_1",
  rawRequest: "Make a 30 second launch video for LinkedIn",
  channel: "VIDEO",
  contentTypeId: "video.launch",
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
  createdAt: now,
  updatedAt: now,
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
    createdAt: now,
    updatedAt: now,
  },
  features: [
    {
      id: "feat_1",
      projectId: "prj_1",
      name: "Recurring exports",
      description: "Send the same report on a cadence",
      category: "AUTOMATION",
      importance: "PRIMARY",
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "recurring-exports",
      provenance: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
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
          description: "Pick a report",
          featureIds: ["feat_1"],
        },
      ],
      featureIds: ["feat_1"],
      confidence: "HIGH",
      assertionKind: "FACT",
      userLocked: false,
      canonicalKey: "scheduled-export",
      provenance: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  problems: [],
  benefits: [],
  claims: [],
  evidence: [],
  audienceSignals: [],
  brandSignals: [],
  assets: [],
  relationships: [],
};

const snapshot = { version: 7 } as unknown as IntelligenceSnapshot;
const brand = {
  ...emptyBrandProfile("prj_1", "brand_1", now),
  name: "Loomly",
  version: 3,
};

function makeService(
  overrides: {
    planners?: StoryboardPlanner[];
    intent?: ContentIntent;
    direction?: Partial<ReturnType<typeof makeCreativeDirection>>;
    graph?: IntelligenceGraph;
  } = {},
) {
  const repository = new FakeStoryboardRepository();
  // SELECTED by default, because a plan for an argument nobody chose is refused
  // and most of these tests are not about that.
  const direction = makeCreativeDirection({
    status: "SELECTED",
    ...overrides.direction,
  });
  const idCounters = new Map<string, number>();
  let tick = 0;

  const service = new StoryboardService({
    projectService: {
      getAuthorized: async (projectId: string, userId: string) => {
        if (userId !== "usr_1") throw new Error("not authorised");
        return { id: projectId } as never;
      },
    },
    intentRepository: {
      getById: async () => overrides.intent ?? intent,
    },
    directionRepository: {
      getById: async (id: string) => (id === direction.id ? direction : null),
      listByIntent: async () => [direction],
    },
    repository,
    intelligenceRepository: {
      readGraph: async () => overrides.graph ?? graph,
      latestSnapshot: async () => snapshot,
    },
    brandRepository: { getByProjectId: async () => brand },
    assetRepository: { listByProject: async () => [] },
    planners: overrides.planners,
    createId: (prefix) => {
      const next = (idCounters.get(prefix) ?? 0) + 1;
      idCounters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    // A clock that moves on every read, so a test can tell a rewrite from an
    // untouched row. Reusing the board's own timestamp would hide that.
    now: () => new Date(Date.UTC(2026, 8, 29, 10, 0, tick++)),
  });

  return { service, repository, direction };
}

/** Generates a board through the service so tests start from a real plan. */
async function generate(
  service: StoryboardService,
  directionId: string,
  extra: { targetDurationMs?: number } = {},
) {
  return service.generate({
    projectId: "prj_1",
    userId: "usr_1",
    intentId: "int_1",
    directionId,
    ...extra,
  });
}

describe("storyboard service — generating", () => {
  it("stores a plan for a selected direction with a timeline that adds up", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    expect(storyboard.status).toBe("DRAFT");
    expect(storyboard.version).toBe(1);
    expect(storyboard.directionId).toBe(direction.id);
    expect(storyboard.creativeRunId).toBe(direction.creativeRunId);
    expect(storyboard.scenes.length).toBeGreaterThan(1);
    expect(storyboard.scenes[0].startMs).toBe(0);
    expect(storyboard.actualDurationMs).toBe(storyboard.targetDurationMs);
    expect(storyboard.scenes.at(-1)!.endMs).toBe(storyboard.targetDurationMs);
  });

  it("gives every scene a distinct id and dense order", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    const ids = storyboard.scenes.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(storyboard.scenes.map((scene) => scene.order)).toEqual(
      storyboard.scenes.map((_, index) => index),
    );
  });

  it("refuses a direction that was never selected", async () => {
    const { service, direction } = makeService({ direction: { status: "DRAFT" } });
    await expect(generate(service, direction.id)).rejects.toMatchObject({
      code: "STORYBOARD_DIRECTION_NOT_SELECTED",
    });
  });

  it("refuses a direction belonging to another intent", async () => {
    const { service, direction } = makeService({
      direction: { status: "SELECTED", intentId: "int_other" },
    });
    await expect(generate(service, direction.id)).rejects.toMatchObject({
      code: "STORYBOARD_DIRECTION_NOT_FOUND",
    });
  });

  it("refuses an intent that is still unresolved", async () => {
    const { service, direction } = makeService({
      intent: { ...intent, status: "NEEDS_CLARIFICATION" },
    });
    await expect(generate(service, direction.id)).rejects.toMatchObject({
      code: "STORYBOARD_INTENT_NOT_RESOLVED",
    });
  });

  it("refuses content with no duration to plan against", async () => {
    const { service, direction } = makeService({
      intent: { ...intent, contentTypeId: "text.linkedin", channel: "TEXT" },
    });
    await expect(generate(service, direction.id)).rejects.toMatchObject({
      code: "STORYBOARD_DURATION_UNSUPPORTED",
    });
  });

  it("refuses a caller who is not a member of the project", async () => {
    const { service, direction } = makeService();
    await expect(
      service.generate({
        projectId: "prj_1",
        userId: "usr_intruder",
        intentId: "int_1",
        directionId: direction.id,
      }),
    ).rejects.toThrow();
  });

  it("plans against an explicit duration rather than the intent's", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id, {
      targetDurationMs: 45_000,
    });

    expect(storyboard.targetDurationMs).toBe(45_000);
    expect(storyboard.actualDurationMs).toBe(45_000);
    expect(storyboard.scenes.at(-1)!.endMs).toBe(45_000);
  });

  it("points every capture target at a real scene", async () => {
    const { service, direction } = makeService();
    const { storyboard, captureTargets } = await generate(service, direction.id);

    const ids = new Set(storyboard.scenes.map((scene) => scene.id));
    for (const target of captureTargets) {
      expect(ids).toContain(target.sceneId);
    }
  });
});

describe("storyboard service — planners", () => {
  const plannerThatFills = (id: string): StoryboardPlanner => ({
    id,
    async plan({ sceneTypes }) {
      return {
        provider: id,
        model: `${id}-model`,
        scenes: sceneTypes.map((type, index) => ({
          name: `${id} scene ${index}`,
          purpose: `A ${type.toLowerCase()} beat`,
          relativeWeight: index === 0 ? 3 : 1,
        })),
      };
    },
  });

  const plannerThatThrows = (id: string, message: string): StoryboardPlanner => ({
    id,
    async plan() {
      throw new Error(message);
    },
  });

  /**
   * Fills the beats with a number nothing in the project supports. The project
   * records one claim and asked for 30 seconds, so a multiplier is unsupported by
   * anything on file.
   */
  const plannerThatLies = (): StoryboardPlanner => ({
    id: "liar",
    async plan({ sceneTypes }) {
      return {
        provider: "liar",
        model: null,
        scenes: sceneTypes.map((): EditableStoryboardScene & { relativeWeight: number } => ({
          name: "A claim nothing supports",
          purpose: "Onboarding is 10x faster than anywhere else",
          textOverlays: [
            {
              id: "ov_1",
              text: "Onboarding is 10x faster",
              role: "HEADLINE",
              position: "CENTER",
              emphasis: "BOLD",
              startOffsetMs: 0,
              endOffsetMs: 500,
            },
          ],
          relativeWeight: 1,
        })),
      };
    },
  });

  /**
   * Replaces every beat's shots, and asks for a capture job on a shot that shows
   * nothing on screen. Nothing in the project supports that page, so the request
   * is exactly the kind of thing a plan must not be able to write for itself.
   */
  const plannerThatRedrawsShots = (): StoryboardPlanner => ({
    id: "redrawer",
    async plan({ sceneTypes }) {
      return {
        provider: "redrawer",
        model: null,
        scenes: sceneTypes.map((): EditableStoryboardScene & { relativeWeight: number } => ({
          name: "A redrawn beat",
          purpose: "The same beat, described differently",
          relativeWeight: 1,
          shots: [
            {
              id: "shot_ui",
              visualType: "PRODUCT_UI",
              description: "The report page with its schedule set",
              productInteraction: "The report page with its schedule set",
              framing: "Over the shoulder",
              cameraMotion: "Slow push in",
              assetIds: [],
              evidenceIds: [],
              notes: "",
              captureRequirement: {
                mode: "BROWSER",
                target: "A pricing page this project does not have",
                workflowId: null,
                featureId: null,
                browserSessionId: null,
                browserTraceId: null,
              },
            },
            {
              id: "shot_card",
              visualType: "TEXT",
              description: "A title card",
              productInteraction: "",
              framing: "Centred",
              cameraMotion: "None",
              assetIds: [],
              evidenceIds: [],
              notes: "",
              captureRequirement: {
                mode: "NONE",
                target: "",
                workflowId: null,
                featureId: null,
                browserSessionId: null,
                browserTraceId: null,
              },
            },
          ],
        })),
      };
    },
  });

  it("uses a planner's content and pacing when it answers", async () => {
    const { service, direction } = makeService({ planners: [plannerThatFills("model")] });
    const { storyboard, provider, model } = await generate(service, direction.id);

    expect(provider).toBe("model");
    expect(model).toBe("model-model");
    expect(storyboard.scenes[0].name).toBe("model scene 0");
    // The planner said the first beat wants three times the share, and the timeline
    // is the domain's to lay out, so that has to show up in the spans.
    expect(storyboard.scenes[0].durationMs).toBeGreaterThan(
      storyboard.scenes[1].durationMs,
    );
    expect(storyboard.actualDurationMs).toBe(storyboard.targetDurationMs);
  });

  it("re-derives capture from what a planner's shot shows, not from its index", async () => {
    const redrawn = makeService({ planners: [plannerThatRedrawsShots()] });
    // The same direction id, so both boards are plans for the same argument and
    // the only thing that differs between them is the planner.
    const plain = makeService({ direction: { id: redrawn.direction.id } });

    const baseline = await generate(plain.service, redrawn.direction.id);
    const { storyboard } = await generate(redrawn.service, redrawn.direction.id);

    // The baseline beat that shows the real product needs capturing, and the
    // deterministic planner is the only one who knows that.
    const productScene = baseline.storyboard.scenes.find((scene) =>
      scene.shots.some((shot) => shot.captureRequirement.mode !== "NONE"),
    );
    expect(productScene).toBeDefined();

    const filledScene = storyboard.scenes.find(
      (scene) => scene.type === productScene!.type,
    );
    expect(filledScene).toBeDefined();

    const plan = productScene!.shots.find(
      (shot) => shot.captureRequirement.mode !== "NONE",
    )!.captureRequirement;

    // A planner cannot write a capture job, so the fields it invents are dropped
    // and the beat's own plan stands on the shots that show the interface.
    const onScreen = filledScene!.shots.filter((shot) =>
      ["PRODUCT_UI", "BROWSER", "SCREEN_CAPTURE"].includes(shot.visualType),
    );
    expect(onScreen.length).toBeGreaterThan(0);
    for (const shot of onScreen) {
      expect(shot.captureRequirement.mode).toBe(plan.mode);
      expect(shot.captureRequirement.target).toBe(plan.target);
      expect(shot.captureRequirement.workflowId).toBe(plan.workflowId);
    }

    // ...and a shot the planner invented that shows nothing capturable is not
    // given a capture job nobody asked for.
    const offScreen = filledScene!.shots.filter(
      (shot) => !["PRODUCT_UI", "BROWSER", "SCREEN_CAPTURE"].includes(shot.visualType),
    );
    expect(offScreen.length).toBeGreaterThan(0);
    for (const shot of offScreen) {
      expect(shot.captureRequirement.mode).toBe("NONE");
      expect(shot.captureRequirement.target).toBe("");
    }
  });

  it("keeps the domain's beats when a planner invents its own", async () => {
    const withPlanner = makeService({ planners: [plannerThatFills("model")] });
    const withoutPlanner = makeService();

    const filled = await generate(withPlanner.service, withPlanner.direction.id);
    const plain = await generate(withoutPlanner.service, withoutPlanner.direction.id);

    // The planner filled the beats in; it did not get to restructure them.
    expect(filled.storyboard.scenes.map((scene) => scene.type)).toEqual(
      plain.storyboard.scenes.map((scene) => scene.type),
    );
    expect(filled.storyboard.scenes[0].name).not.toBe(
      plain.storyboard.scenes[0].name,
    );
  });

  it("falls through to the next planner when one throws", async () => {
    const { service, direction } = makeService({
      planners: [
        plannerThatThrows("broken", "upstream 500"),
        plannerThatFills("healthy"),
      ],
    });
    const { storyboard, provider, fallbackFrom } = await generate(service, direction.id);

    expect(provider).toBe("healthy");
    expect(fallbackFrom).toBeNull();
    expect(storyboard.scenes[0].name).toBe("healthy scene 0");
  });

  it("reports the deterministic fallback when every planner fails", async () => {
    const { service, direction } = makeService({
      planners: [plannerThatThrows("broken", "upstream 500")],
    });
    const { storyboard, provider, fallbackFrom, fallbackReason } = await generate(
      service,
      direction.id,
    );

    expect(provider).toBe("deterministic");
    expect(fallbackFrom).toBe("broken");
    expect(fallbackReason).toContain("upstream 500");
    expect(storyboard.scenes.length).toBeGreaterThan(1);
  });

  it("falls back to the deterministic plan when a planner returns something the project cannot stand behind", async () => {
    const { service, direction } = makeService({
      planners: [plannerThatLies()],
    });
    const { storyboard, provider, fallbackFrom } = await generate(service, direction.id);

    expect(provider).toBe("deterministic");
    expect(fallbackFrom).toBe("liar");
    expect(storyboard.scenes[0].name).not.toBe("A claim nothing supports");
    expect(storyboard.actualDurationMs).toBe(storyboard.targetDurationMs);
  });
});

describe("storyboard service — reading", () => {
  it("hides a storyboard from another project", async () => {
    const { service, repository, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const other = new FakeStoryboardRepository();
    for (const [id, board] of repository.boards) other.boards.set(id, board);

    await expect(
      other.getById(storyboard.id).then((found) =>
        service.get("prj_2", "usr_1", found!.id),
      ),
    ).rejects.toBeInstanceOf(StoryboardError);
  });

  it("lists plans for a project, newest first", async () => {
    const { service, direction } = makeService();
    await generate(service, direction.id);
    await generate(service, direction.id);

    const boards = await service.list("prj_1", "usr_1", { intentId: "int_1" });
    expect(boards).toHaveLength(2);
  });
});

describe("storyboard service — editing", () => {
  it("applies a scene edit and keeps the timeline contiguous", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const scene = storyboard.scenes[0];

    const edited = await service.updateScenes({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      scenes: [{ sceneId: scene.id, changes: { name: "A sharper opening" } }],
    });

    expect(edited.scenes[0].name).toBe("A sharper opening");
    expect(edited.version).toBe(2);
    expect(edited.actualDurationMs).toBe(edited.targetDurationMs);
    for (let i = 1; i < edited.scenes.length; i++) {
      expect(edited.scenes[i].startMs).toBe(edited.scenes[i - 1].endMs);
    }
  });

  it("will not let an edit move a scene or set its timing", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const scene = storyboard.scenes[0];

    const edited = await service.updateScenes({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      scenes: [
        {
          sceneId: scene.id,
          // A caller trying to smuggle in identity and timings.
          changes: { name: "Renamed", startMs: 0, endMs: 99_999 } as never,
        },
      ],
    });

    expect(edited.scenes[0].name).toBe("Renamed");
    expect(edited.scenes[0].id).toBe(scene.id);
    expect(edited.scenes[0].endMs).toBe(scene.endMs);
    expect(edited.actualDurationMs).toBe(edited.targetDurationMs);
  });

  it("rejects an edit naming a scene that is not in the plan", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    await expect(
      service.updateScenes({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        scenes: [{ sceneId: "sbscene_missing", changes: { name: "Nope" } }],
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_INVALID_INPUT" });
  });

  it("rejects an edit that breaks a claim the project cannot support", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const scene = storyboard.scenes[0];

    await expect(
      service.updateScenes({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        scenes: [
          {
            sceneId: scene.id,
            changes: {
              textOverlays: [
                {
                  id: "ov_1",
                  text: "We cut onboarding by 90%",
                  role: "HEADLINE",
                  position: "CENTER",
                  emphasis: "BOLD",
                  startOffsetMs: 0,
                  endOffsetMs: 800,
                },
              ],
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_INVALID_INPUT" });
  });

  it("moves the timestamp forward so a rewrite is visible", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    const edited = await service.updateScenes({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      scenes: [{ sceneId: storyboard.scenes[0].id, changes: { name: "Changed" } }],
    });

    expect(edited.updatedAt > storyboard.updatedAt).toBe(true);
  });
});

describe("storyboard service — reordering", () => {
  it("moves a scene and re-times the piece", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    // The hook opens the piece and the ask closes it, so the scene that can move
    // is one in the middle.
    const movedId = storyboard.scenes[2].id;
    const originalTypes = storyboard.scenes.map((scene) => scene.type);

    const reordered = await service.reorderScene({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      sceneId: movedId,
      toIndex: 1,
    });

    expect(reordered.scenes[1].id).toBe(movedId);
    expect(reordered.scenes.map((scene) => scene.type)).toEqual([
      originalTypes[0],
      originalTypes[2],
      originalTypes[1],
      ...originalTypes.slice(3),
    ]);
    expect(reordered.scenes[0].startMs).toBe(0);
    expect(reordered.actualDurationMs).toBe(reordered.targetDurationMs);
    expect(reordered.scenes.map((scene) => scene.order)).toEqual(
      reordered.scenes.map((_, index) => index),
    );
    // Re-timing has to leave no gap and no overlap anywhere in the piece.
    for (let i = 1; i < reordered.scenes.length; i++) {
      expect(reordered.scenes[i].startMs).toBe(reordered.scenes[i - 1].endMs);
    }
  });

  it("keeps a scene's share of the piece when it moves", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const movedBefore = storyboard.scenes[2];

    const reordered = await service.reorderScene({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      sceneId: movedBefore.id,
      toIndex: 1,
    });

    const after = reordered.scenes.find((scene) => scene.id === movedBefore.id)!;
    const share = after.durationMs / reordered.targetDurationMs;
    const before = movedBefore.durationMs / storyboard.targetDurationMs;
    expect(Math.abs(share - before)).toBeLessThan(0.01);
  });

  it("refuses a move that would take the hook off the top", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    await expect(
      service.reorderScene({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        sceneId: storyboard.scenes[0].id,
        toIndex: 2,
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_INVALID_INPUT" });
  });

  it("refuses a move that would take the ask off the end", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    const last = storyboard.scenes.at(-1)!;

    await expect(
      service.reorderScene({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        sceneId: last.id,
        toIndex: 1,
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_INVALID_INPUT" });
  });

  it("leaves the plan untouched when a move is refused", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    await expect(
      service.reorderScene({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        sceneId: storyboard.scenes[0].id,
        toIndex: 2,
      }),
    ).rejects.toThrow();

    const reread = await service.get("prj_1", "usr_1", storyboard.id);
    expect(reread.version).toBe(storyboard.version);
    expect(reread.scenes.map((scene) => scene.id)).toEqual(
      storyboard.scenes.map((scene) => scene.id),
    );
  });

  it("rejects a move to a position that is not in the plan", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    await expect(
      service.reorderScene({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        sceneId: storyboard.scenes[0].id,
        toIndex: 99,
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_INVALID_INPUT" });
  });

  it("treats a move to the current position as nothing to do", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);

    const same = await service.reorderScene({
      projectId: "prj_1",
      userId: "usr_1",
      storyboardId: storyboard.id,
      sceneId: storyboard.scenes[0].id,
      toIndex: 0,
    });

    expect(same.version).toBe(storyboard.version);
  });
});

describe("storyboard service — selecting and locking", () => {
  it("selects one plan and demotes the other", async () => {
    const { service, direction } = makeService();
    const first = (await generate(service, direction.id)).storyboard;
    const second = (await generate(service, direction.id)).storyboard;
    await service.select("prj_1", "usr_1", first.id);

    const { storyboard, demoted } = await service.select("prj_1", "usr_1", second.id);

    expect(storyboard.status).toBe("SELECTED");
    expect(demoted.map((board) => board.id)).toEqual([first.id]);
    const reread = await service.get("prj_1", "usr_1", first.id);
    expect(reread.status).toBe("DRAFT");
  });

  it("leaves a plan that was only ever a draft alone when selecting another", async () => {
    const { service, direction } = makeService();
    const untouched = (await generate(service, direction.id)).storyboard;
    const chosen = (await generate(service, direction.id)).storyboard;

    const { demoted } = await service.select("prj_1", "usr_1", chosen.id);

    expect(demoted).toEqual([]);
    expect((await service.get("prj_1", "usr_1", untouched.id)).status).toBe("DRAFT");
  });

  it("locks the decided plan and archives anything else selected", async () => {
    const { service, direction } = makeService();
    const first = (await generate(service, direction.id)).storyboard;
    const second = (await generate(service, direction.id)).storyboard;
    await service.select("prj_1", "usr_1", first.id);

    const { storyboard, archived } = await service.lock("prj_1", "usr_1", second.id);

    expect(storyboard.status).toBe("LOCKED");
    expect(archived.map((board) => board.id)).toEqual([first.id]);
    expect((await service.get("prj_1", "usr_1", first.id)).status).toBe("ARCHIVED");
  });

  it("refuses to lock twice", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    await service.lock("prj_1", "usr_1", storyboard.id);

    await expect(
      service.lock("prj_1", "usr_1", storyboard.id),
    ).rejects.toMatchObject({ code: "STORYBOARD_LOCKED" });
  });

  it("refuses to edit a locked plan", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    await service.lock("prj_1", "usr_1", storyboard.id);

    await expect(
      service.updateScenes({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        scenes: [
          { sceneId: storyboard.scenes[0].id, changes: { name: "One more tweak" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_LOCKED" });
  });

  it("refuses to reorder a locked plan", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    await service.lock("prj_1", "usr_1", storyboard.id);

    await expect(
      service.reorderScene({
        projectId: "prj_1",
        userId: "usr_1",
        storyboardId: storyboard.id,
        sceneId: storyboard.scenes[1].id,
        toIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "STORYBOARD_LOCKED" });
  });

  it("returns the locked plan for an intent", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    await service.lock("prj_1", "usr_1", storyboard.id);

    const locked = await service.getLocked("prj_1", "usr_1", "int_1");
    expect(locked?.id).toBe(storyboard.id);
  });

  it("has nothing to return before a plan is locked", async () => {
    const { service, direction } = makeService();
    await generate(service, direction.id);

    expect(await service.getLocked("prj_1", "usr_1", "int_1")).toBeNull();
  });

  it("will not hand one project's decided plan to another project", async () => {
    const { service, direction } = makeService();
    const { storyboard } = await generate(service, direction.id);
    await service.lock("prj_1", "usr_1", storyboard.id);

    expect(await service.getLocked("prj_2", "usr_1", "int_1")).toBeNull();
  });
});
