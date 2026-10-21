import { describe, expect, it } from "vitest";
import {
  buildStoryboardVideoPlan,
  type StoryboardVideoStoryboard,
} from "../storyboard-video";

const storyboard: StoryboardVideoStoryboard = {
  name: "Portfolio launch",
  durationMs: 8_000,
  scenes: [
    {
      name: "Opening hook",
      startMs: 0,
      endMs: 4_000,
      textOverlays: [{ text: "Start here" }],
      voiceoverPlan: { text: "You know the problem" },
    },
    {
      name: "Proof",
      startMs: 4_000,
      endMs: 8_000,
      textOverlays: [],
      voiceoverPlan: { text: "And it works" },
    },
  ],
};

describe("storyboard video plan", () => {
  it("lays out a vertical video with timed scene text", () => {
    const plan = buildStoryboardVideoPlan({
      storyboard,
      format: "VERTICAL",
      backgroundAssetId: "asset_1",
    });

    expect(plan.composition).toEqual({
      name: "Portfolio launch video",
      width: 1080,
      height: 1920,
      frameRate: 30,
      durationMs: 8_000,
    });

    expect(plan.layers.map((layer) => layer.name)).toEqual([
      "Product screenshot",
      "Text backdrop",
      "Title",
      "Scene · Opening hook",
      "Scene · Proof",
    ]);

    const media = plan.layers[0]!;
    expect(media).toMatchObject({
      type: "MEDIA",
      assetRef: "asset:asset_1",
      fit: "COVER",
      zIndex: 1,
    });

    const hook = plan.layers[3]!;
    expect(hook.textContent).toContain("Opening hook");
    expect(hook.textContent).toContain("Start here");
    expect(hook.keyframes?.map((entry) => entry.timeMs)).toEqual([0, 3_850]);

    const proof = plan.layers[4]!;
    expect(proof.keyframes?.map((entry) => entry.timeMs)).toEqual([
      3_999, 4_000, 7_850,
    ]);
  });

  it("supports landscape and square frames", () => {
    expect(
      buildStoryboardVideoPlan({ storyboard, format: "LANDSCAPE" }).composition,
    ).toMatchObject({ width: 1920, height: 1080 });
    expect(
      buildStoryboardVideoPlan({ storyboard, format: "SQUARE" }).composition,
    ).toMatchObject({ width: 1080, height: 1080 });
  });

  it("keeps every scene inside a duration that covers the last scene", () => {
    const plan = buildStoryboardVideoPlan({
      storyboard: { ...storyboard, durationMs: 5_000 },
      format: "VERTICAL",
    });

    expect(plan.composition.durationMs).toBe(8_000);

    for (const layer of plan.layers) {
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.x + layer.width).toBeLessThanOrEqual(
        plan.composition.width,
      );
      expect(layer.y + layer.height).toBeLessThanOrEqual(
        plan.composition.height,
      );

      const times = layer.keyframes?.map((entry) => entry.timeMs) ?? [];
      expect(new Set(times).size).toBe(times.length);
      for (const time of times) {
        expect(time).toBeGreaterThanOrEqual(0);
        expect(time).toBeLessThanOrEqual(plan.composition.durationMs);
      }
    }
  });

  it("skips the media layer when there is no background asset", () => {
    const plan = buildStoryboardVideoPlan({
      storyboard,
      format: "VERTICAL",
    });

    expect(plan.layers.some((layer) => layer.type === "MEDIA")).toBe(false);
  });
});
