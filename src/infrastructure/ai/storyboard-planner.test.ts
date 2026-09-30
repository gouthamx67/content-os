/**
 * The AI storyboard planner is the second path where text a model wrote becomes a
 * stored plan. These tests pin the three behaviours the service relies on:
 *
 *  - a reply that is not a well-formed scene list raises, so the service falls
 *    back to the deterministic plan instead of storing a truncated one;
 *  - a wrong beat count raises, because quietly keeping the first three of five
 *    stores a plan with the argument missing;
 *  - a field the model got wrong is dropped rather than stored, so a hallucinated
 *    id or an unknown visual type costs the scene one field and not the scene.
 */
import { describe, expect, it, vi } from "vitest";

import { AiStoryboardPlanner } from "./storyboard-planner";
import { makeStoryboardContext } from "../../testing/fakes";
import type { AIProvider } from "../../core/ports/ai-provider";
import type { StoryboardPlannerRequest } from "../../core/ports/storyboard-planner";

function providerReturning(text: string): AIProvider {
  return { generate: vi.fn(async () => ({ text, model: "test-model" })) };
}

const context = makeStoryboardContext();

function requestFor(sceneTypes: StoryboardPlannerRequest["sceneTypes"]): StoryboardPlannerRequest {
  return { context, sceneTypes };
}

const beats: StoryboardPlannerRequest["sceneTypes"] = ["HOOK", "PROOF", "CTA"];

function reply(scenes: unknown): string {
  return JSON.stringify({ scenes });
}

const goodScene = {
  name: "The opening",
  purpose: "earn the next seconds",
  relativeWeight: 1.5,
};

describe("AI storyboard planner — responses it accepts", () => {
  it("fills in every beat it was given", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          goodScene,
          { name: "The proof", purpose: "show it", relativeWeight: 1 },
          { name: "The ask", purpose: "close", relativeWeight: 1.2 },
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0].name).toBe("The opening");
    expect(result.scenes[2].purpose).toBe("close");
    expect(result.scenes[0].relativeWeight).toBe(1.5);
  });

  it("reports itself as the provider and the model that answered", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(reply([goodScene, goodScene, goodScene])),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.provider).toBe("ai-storyboard-planner");
    expect(result.model).toBe("test-model");
  });

  it("unwraps a fenced reply", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning("```json\n" + reply([goodScene, goodScene, goodScene]) + "\n```"),
    );

    await expect(planner.plan(requestFor(beats))).resolves.toBeTruthy();
  });

  it("recovers a reply truncated after the JSON object", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(`Here you go:\n${reply([goodScene, goodScene, goodScene])}\nHope that helps!`),
    );

    await expect(planner.plan(requestFor(beats))).resolves.toBeTruthy();
  });
});

describe("AI storyboard planner — responses it refuses", () => {
  it("raises rather than store a plan that is not JSON", async () => {
    const planner = new AiStoryboardPlanner(providerReturning("I'd rather describe it."));

    await expect(planner.plan(requestFor(beats))).rejects.toThrow(/unreadable/);
  });

  it("raises when the beat count does not match the beats it was given", async () => {
    const planner = new AiStoryboardPlanner(providerReturning(reply([goodScene])));

    await expect(planner.plan(requestFor(beats))).rejects.toThrow(
      /1 scenes for 3 beats/,
    );
  });

  it("raises when the response holds no scenes at all", async () => {
    const planner = new AiStoryboardPlanner(providerReturning(reply([])));

    await expect(planner.plan(requestFor(beats))).rejects.toThrow(/no scenes/);
  });

  it("raises when a scene is not an object", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(reply([goodScene, "a scene, probably", goodScene])),
    );

    await expect(planner.plan(requestFor(beats))).rejects.toThrow(/not an object/);
  });
});

describe("AI storyboard planner — fields it will not trust", () => {
  it("keeps the good parts of a scene and drops a hallucinated reference", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          {
            name: "Real name",
            purpose: "Real purpose",
            featureIds: ["feat_does_not_exist"],
            claimIds: [],
            relativeWeight: 1,
          },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));
    const first = result.scenes[0];

    // The invented id is gone, and so is the empty list that would have replaced
    // a reference the beat already had.
    expect(first.name).toBe("Real name");
    expect(first.purpose).toBe("Real purpose");
    expect(first.featureIds).toBeUndefined();
    expect(first.claimIds).toBeUndefined();
  });

  it("keeps references the project actually has", async () => {
    const knownId = context.product.features[0]?.id;
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          { ...goodScene, featureIds: [knownId, "feat_invented"] },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.scenes[0].featureIds).toEqual([knownId]);
  });

  it("drops a visual type it does not recognise rather than storing it", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          {
            ...goodScene,
            shots: [{ description: "A thing on screen", visualType: "HOLOGRAM" }],
          },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.scenes[0].shots?.[0].visualType).toBe("CUSTOM");
    expect(result.scenes[0].shots?.[0].description).toBe("A thing on screen");
  });

  it("drops a text role it does not recognise", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          {
            ...goodScene,
            textOverlays: [{ text: "Real words", role: "SUPER_TITLE" }],
          },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));
    const overlay = result.scenes[0].textOverlays?.[0];

    expect(overlay?.text).toBe("Real words");
    // The beat decides this, not the model: a hook that opens with no words is a
    // mistake, so the role the hook implies is filled in.
    expect(overlay?.role).toBe("HEADLINE");
  });

  it("lets the beat decide the text role for the closing ask", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          goodScene,
          goodScene,
          { ...goodScene, textOverlays: [{ text: "Start free trial" }] },
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.scenes[2].textOverlays?.[0].role).toBe("CTA");
  });

  it("ignores a weight it cannot make sense of", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          { ...goodScene, relativeWeight: "very heavy" },
          { ...goodScene, relativeWeight: Number.POSITIVE_INFINITY },
          { ...goodScene, relativeWeight: -5 },
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    for (const scene of result.scenes) {
      expect(Number.isFinite(scene.relativeWeight)).toBe(true);
      expect(scene.relativeWeight).toBeGreaterThan(0);
    }
  });

  it("never lets a model state a timing or an id", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          { ...goodScene, id: "scene_injected", startMs: 0, endMs: 99_999, order: 7 },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));
    const scene = result.scenes[0] as Record<string, unknown>;

    expect(scene["id"]).toBeUndefined();
    expect(scene["startMs"]).toBeUndefined();
    expect(scene["endMs"]).toBeUndefined();
    expect(scene["order"]).toBeUndefined();
  });

  it("leaves the capture plan to the deterministic beat", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          {
            ...goodScene,
            shots: [
              {
                description: "The pricing page",
                captureRequirement: {
                  mode: "BROWSER",
                  target: "https://invented.example/pricing",
                },
              },
            ],
          },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    // A model cannot know which session exists or which page is real, so the shot
    // carries no capture plan and the beat's own stands.
    expect(result.scenes[0].shots?.[0].captureRequirement.mode).toBe("NONE");
  });

  it("accepts a music direction written as a sentence", async () => {
    const planner = new AiStoryboardPlanner(
      providerReturning(
        reply([
          { ...goodScene, musicDirection: "Low and sustained underneath" },
          goodScene,
          goodScene,
        ]),
      ),
    );

    const result = await planner.plan(requestFor(beats));

    expect(result.scenes[0].musicDirection?.style).toBe("Low and sustained underneath");
    expect(result.scenes[0].musicDirection?.tempoBpm).toBeNull();
  });
});
