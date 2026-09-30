import { describe, expect, it } from "vitest";
import { makeStoryboardContext } from "../../testing/fakes";
import { planStoryboard } from "./deterministic-storyboard-planner";
import { validateStoryboard } from "./storyboard-validator";
import type { Storyboard } from "../domain/storyboard";

function plan(context = makeStoryboardContext()): ReturnType<typeof planStoryboard> {
  return planStoryboard({ context, idPrefix: "sb" });
}

function asBoard(
  context: ReturnType<typeof makeStoryboardContext>,
  scenes: ReturnType<typeof planStoryboard>["scenes"],
  targetDurationMs = context.requirements.targetDurationMs,
): Storyboard {
  return {
    id: "sb_1",
    projectId: context.projectId,
    intentId: context.intentId,
    directionId: context.directionId,
    name: "Test",
    status: "DRAFT",
    targetDurationMs,
    actualDurationMs: scenes[scenes.length - 1]?.endMs ?? 0,
    aspectRatio: null,
    platforms: [],
    brandVersion: null,
    intelligenceVersion: null,
    creativeRunId: "crun_1",
    version: 1,
    scenes,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("deterministic storyboard planner", () => {
  it("covers the requested duration exactly, with no gap or overlap", () => {
    for (const targetDurationMs of [5_000, 15_000, 30_000, 45_000, 60_000, 90_000]) {
      const context = makeStoryboardContext({ targetDurationMs });
      const result = plan(context);
      const last = result.scenes[result.scenes.length - 1];

      expect(result.scenes[0].startMs).toBe(0);
      expect(last.endMs).toBe(targetDurationMs);
      expect(result.actualDurationMs).toBe(targetDurationMs);

      for (let index = 1; index < result.scenes.length; index += 1) {
        expect(result.scenes[index].startMs).toBe(result.scenes[index - 1].endMs);
      }
      for (const scene of result.scenes) {
        expect(scene.endMs - scene.startMs).toBe(scene.durationMs);
        expect(scene.durationMs).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("opens on a hook and closes on the ask, because those are structural", () => {
    const result = plan();
    expect(result.scenes[0].type).toBe("HOOK");
    expect(result.scenes[result.scenes.length - 1].type).toBe("CTA");
  });

  it("still lands the piece when the direction has no ask", () => {
    const context = makeStoryboardContext({
      direction: { cta: null },
      requirements: { cta: null },
    });
    const result = plan(context);
    const last = result.scenes[result.scenes.length - 1];

    expect(last.type).toBe("CUSTOM");
    expect(last.endMs).toBe(context.requirements.targetDurationMs);
  });

  it("orders scenes densely from zero, so the order is the timeline", () => {
    const result = plan();
    result.scenes.forEach((scene, index) => {
      expect(scene.order).toBe(index);
    });
  });

  it("produces the same plan every time, so a plan can be reviewed", () => {
    const context = makeStoryboardContext();
    expect(plan(context)).toEqual(plan(context));
  });

  it("references only ids the context handed over", () => {
    const context = makeStoryboardContext();
    const result = plan(context);
    const features = new Set(context.product.features.map((feature) => feature.id));
    const workflows = new Set(context.product.workflows.map((workflow) => workflow.id));
    const claims = new Set(context.product.claims.map((claim) => claim.id));
    const evidence = new Set(context.evidence.map((item) => item.id));
    const assets = new Set(context.assets.map((asset) => asset.id));

    for (const scene of result.scenes) {
      for (const id of scene.featureIds) expect(features.has(id)).toBe(true);
      for (const id of scene.workflowIds) expect(workflows.has(id)).toBe(true);
      for (const id of scene.claimIds) expect(claims.has(id)).toBe(true);
      for (const id of scene.evidenceIds) expect(evidence.has(id)).toBe(true);
      for (const shot of scene.shots) {
        for (const id of shot.assetIds) expect(assets.has(id)).toBe(true);
      }
    }
  });

  it("scales the scene count with the duration rather than fixing it", () => {
    const short = plan(makeStoryboardContext({ targetDurationMs: 5_000 }));
    const long = plan(makeStoryboardContext({ targetDurationMs: 180_000 }));
    expect(long.scenes.length).toBeGreaterThan(short.scenes.length);
    expect(long.scenes.length).toBeLessThanOrEqual(20);
  });

  it("keeps every scene long enough to be built", () => {
    const result = plan(makeStoryboardContext({ targetDurationMs: 5_000 }));
    for (const scene of result.scenes) {
      expect(scene.durationMs).toBeGreaterThan(0);
    }
  });

  it("gives the hook and the ask text, drawn from the direction's own words", () => {
    const context = makeStoryboardContext();
    const result = plan(context);
    const hook = result.scenes[0];
    const cta = result.scenes[result.scenes.length - 1];

    expect(hook.textOverlays[0].text).toBe(context.direction.hook.statement);
    expect(cta.textOverlays[0].text).toBe(context.direction.cta);
  });

  it("leaves out a caption the project cannot support rather than inventing a number", () => {
    const context = makeStoryboardContext({
      direction: { hook: { statement: "Cut status chasing by 90%", mechanism: "Open on the pain", emotionalTrigger: "relief" } },
    });
    const result = plan(context);
    // The hook line is the only place a number could be stated, and nothing in
    // this project records 90, so it is dropped rather than softened.
    expect(result.scenes[0].textOverlays).toHaveLength(0);
  });

  it("asks for a browser only where there is a real workflow to drive", () => {
    const context = makeStoryboardContext();
    const result = plan(context);
    const capturing = result.scenes.filter((scene) =>
      scene.shots.some((shot) => shot.captureRequirement.mode === "BROWSER"),
    );

    for (const scene of capturing) {
      const shot = scene.shots[0];
      expect(shot.captureRequirement.workflowId).not.toBeNull();
      expect(shot.captureRequirement.target.length).toBeGreaterThan(0);
    }
  });

  it("produces a plan the validator accepts, in every mode", () => {
    for (const mode of ["GUIDED", "BALANCED", "WILD"] as const) {
      const context = makeStoryboardContext({ mode });
      const result = plan(context);
      expect(() => validateStoryboard(asBoard(context, result.scenes), context)).not.toThrow();
    }
  });
});
