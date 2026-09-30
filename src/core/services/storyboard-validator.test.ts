import { describe, expect, it } from "vitest";
import { makeStoryboard, makeStoryboardContext } from "../../testing/fakes";
import {
  isStoryboardValid,
  StoryboardValidationFailure,
  validateStoryboard,
} from "./storyboard-validator";
import type { Storyboard, StoryboardScene } from "../domain/storyboard";

function codesFrom(run: () => unknown): string[] {
  try {
    run();
    return [];
  } catch (error) {
    if (error instanceof StoryboardValidationFailure) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
}

function expectCodes(run: () => unknown, ...expected: string[]): string[] {
  const codes = codesFrom(run);
  for (const code of expected) {
    expect(
      codes,
      `expected ${code}; validator reported: ${codes.join(", ") || "(nothing)"}`,
    ).toContain(code);
  }
  return codes;
}

const base = () => makeStoryboardContext();

/** Applies a change to the first scene of a valid board. */
function withFirstScene(
  change: (scene: StoryboardScene) => StoryboardScene,
  context = base(),
): Storyboard {
  const board = makeStoryboard(context);
  const scenes = board.scenes.map((scene, index) => (index === 0 ? change(scene) : scene));
  return { ...board, scenes };
}

describe("storyboard validator — the plan it accepts", () => {
  it("accepts a plan the deterministic planner produced", () => {
    const context = base();
    expect(() => validateStoryboard(makeStoryboard(context), context)).not.toThrow();
  });

  it("accepts a plan in every mode, with and without a recorded interface", () => {
    for (const mode of ["GUIDED", "BALANCED", "WILD"] as const) {
      const withUi = makeStoryboardContext({ mode });
      expect(() => validateStoryboard(makeStoryboard(withUi), withUi)).not.toThrow();

      const withoutUi = makeStoryboardContext({ mode, assets: [] });
      const board = makeStoryboard(withoutUi);
      // WILD does not require the interface, so a plan without one is legitimate.
      if (mode !== "GUIDED") {
        expect(() => validateStoryboard(board, withoutUi)).not.toThrow();
      }
    }
  });
});

describe("storyboard validator — the timeline", () => {
  it("refuses a plan with a hole in it", () => {
    const board = makeStoryboard();
    const scenes = board.scenes.map((scene, index) =>
      index === 1 ? { ...scene, startMs: scene.startMs + 500 } : scene,
    );
    expectCodes(
      () => validateStoryboard({ ...board, scenes }, base()),
      "STORYBOARD_TIMELINE_DISCONTINUOUS",
    );
  });

  it("refuses a plan that does not end on the requested duration", () => {
    const board = makeStoryboard();
    const scenes = [...board.scenes];
    scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], endMs: scenes[scenes.length - 1].endMs - 300 };
    expectCodes(
      () => validateStoryboard({ ...board, scenes, actualDurationMs: board.targetDurationMs - 300 }, base()),
      "STORYBOARD_DURATION_MISMATCH",
    );
  });

  it("refuses a recorded actual that disagrees with the target", () => {
    const board = makeStoryboard();
    expectCodes(
      () => validateStoryboard({ ...board, actualDurationMs: board.targetDurationMs - 1 }, base()),
      "STORYBOARD_ACTUAL_DURATION_MISMATCH",
    );
  });

  it("refuses a scene whose span disagrees with its own duration", () => {
    expectCodes(
      () => validateStoryboard(withFirstScene((scene) => ({ ...scene, durationMs: scene.durationMs + 10 })), base()),
      "STORYBOARD_SCENE_DURATION_MISMATCH",
    );
  });

  it("refuses an empty plan", () => {
    const board = makeStoryboard();
    expectCodes(
      () => validateStoryboard({ ...board, scenes: [] }, base()),
      "STORYBOARD_NO_SCENES",
    );
  });

  it("refuses a duration too short or too long to be a piece", () => {
    const tooShort = makeStoryboardContext({ targetDurationMs: 1_000 });
    expectCodes(() => validateStoryboard(makeStoryboard(tooShort), tooShort), "STORYBOARD_TARGET_TOO_SHORT");

    const tooLong = makeStoryboardContext({ targetDurationMs: 900_000 });
    expectCodes(() => validateStoryboard(makeStoryboard(tooLong), tooLong), "STORYBOARD_TARGET_TOO_LONG");
  });
});

describe("storyboard validator — references it cannot check", () => {
  it("refuses a scene that rests on a feature the project does not have", () => {
    expectCodes(
      () => validateStoryboard(withFirstScene((scene) => ({ ...scene, featureIds: ["ft_missing"] })), base()),
      "STORYBOARD_UNKNOWN_FEATURE",
    );
  });

  it("refuses a claim the project never recorded", () => {
    expectCodes(
      () => validateStoryboard(withFirstScene((scene) => ({ ...scene, claimIds: ["cl_missing"] })), base()),
      "STORYBOARD_UNKNOWN_CLAIM",
    );
  });

  it("refuses evidence that does not exist", () => {
    expectCodes(
      () => validateStoryboard(withFirstScene((scene) => ({ ...scene, evidenceIds: ["ev_missing"] })), base()),
      "STORYBOARD_UNKNOWN_EVIDENCE",
    );
  });

  it("refuses a shot that uses an asset the project does not have", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({ ...shot, assetIds: ["as_missing"] })),
          })),
          base(),
        ),
      "STORYBOARD_UNKNOWN_ASSET",
    );
  });

  it("refuses a shot pointing at a browser session this project never ran", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({
              ...shot,
              captureRequirement: { ...shot.captureRequirement, browserSessionId: "bs_missing" },
            })),
          })),
          base(),
        ),
      "STORYBOARD_UNKNOWN_SESSION",
    );
  });

  it("refuses a trace the named session never recorded", () => {
    const context = makeStoryboardContext({
      browserCaptures: [{ id: "bs_1", url: "https://app.test", goal: "demo", status: "COMPLETED", traceIds: ["bs_1_000"] }],
    });
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene(
            (scene) => ({
              ...scene,
              shots: scene.shots.map((shot) => ({
                ...shot,
                captureRequirement: {
                  ...shot.captureRequirement,
                  browserSessionId: "bs_1",
                  browserTraceId: "bs_1_999",
                },
              })),
            }),
            context,
          ),
          context,
        ),
      "STORYBOARD_UNKNOWN_TRACE",
    );
  });
});

describe("storyboard validator — capture requirements", () => {
  it("refuses a shot that captures without saying what to capture", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({
              ...shot,
              captureRequirement: { ...shot.captureRequirement, mode: "BROWSER", target: "  " },
            })),
          })),
          base(),
        ),
      "STORYBOARD_CAPTURE_TARGET_MISSING",
    );
  });

  it("refuses a target on a shot that captures nothing", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({
              ...shot,
              captureRequirement: { ...shot.captureRequirement, mode: "NONE", target: "the pricing page" },
            })),
          })),
          base(),
        ),
      "STORYBOARD_CAPTURE_TARGET_WITHOUT_MODE",
    );
  });
});

describe("storyboard validator — copy", () => {
  it("refuses a caption stating a number nothing in the project supports", () => {
    const context = base();
    const board = makeStoryboard(context);
    const scenes = board.scenes.map((scene, index) =>
      index === 0
        ? {
            ...scene,
            textOverlays: [
              { id: "x", role: "HEADLINE" as const, text: "Cut reporting time by 90%", position: "CENTER" as const, emphasis: "BOLD" as const, startOffsetMs: 0, endOffsetMs: 2_000 },
            ],
          }
        : scene,
    );
    expectCodes(
      () => validateStoryboard({ ...board, scenes }, context),
      "STORYBOARD_UNSUPPORTED_QUANTIFIED_CLAIM",
    );
  });

  it("refuses narration stating a number nothing supports", () => {
    const context = base();
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({ ...scene, voiceoverPlan: { text: "Teams save 3 hours a week" } }), context),
          context,
        ),
      "STORYBOARD_UNSUPPORTED_QUANTIFIED_CLAIM",
    );
  });

  it("refuses text that runs past the end of its scene", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            textOverlays: [
              { id: "x", role: "HEADLINE" as const, text: "Later", position: "CENTER" as const, emphasis: "NORMAL" as const, startOffsetMs: 0, endOffsetMs: scene.durationMs + 5_000 },
            ],
          })),
          base(),
        ),
      "STORYBOARD_TEXT_OUT_OF_BOUNDS",
    );
  });

  it("refuses text that is on screen for no time at all", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            textOverlays: [
              { id: "x", role: "HEADLINE" as const, text: "Instant", position: "CENTER" as const, emphasis: "NORMAL" as const, startOffsetMs: 1_000, endOffsetMs: 1_000 },
            ],
          })),
          base(),
        ),
      "STORYBOARD_TEXT_ZERO_LENGTH",
    );
  });
});

describe("storyboard validator — the shape of the piece", () => {
  it("refuses a plan that opens on something other than a hook", () => {
    const context = base();
    const board = makeStoryboard(context);
    const scenes = [...board.scenes];
    scenes[0] = { ...scenes[0], type: "FEATURE" };
    expectCodes(() => validateStoryboard({ ...board, scenes }, context), "STORYBOARD_NO_HOOK");
  });

  it("refuses a plan that drops the ask the direction made", () => {
    const context = base();
    const board = makeStoryboard(context);
    const scenes = [...board.scenes];
    scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], type: "CUSTOM" };
    expectCodes(() => validateStoryboard({ ...board, scenes }, context), "STORYBOARD_MISSING_CTA");
  });

  it("refuses a GUIDED plan that never shows the real interface", () => {
    const context = makeStoryboardContext({ mode: "GUIDED" });
    const board = makeStoryboard(context);
    const scenes = board.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        visualType: "TEXT" as const,
        productInteraction: "",
      })),
    }));
    expectCodes(() => validateStoryboard({ ...board, scenes }, context), "STORYBOARD_PRODUCT_UI_REQUIRED");
  });

  it("tells a user when the project has no interface for a mode that needs one", () => {
    const context = makeStoryboardContext({ mode: "GUIDED", assets: [] });
    const board = makeStoryboard(context);
    const scenes = board.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({ ...shot, visualType: "TEXT" as const, productInteraction: "" })),
    }));
    expectCodes(
      () => validateStoryboard({ ...board, scenes }, context),
      "STORYBOARD_NO_PRODUCT_UI_RECORDED",
    );
  });

  it("refuses a product shot that does not say what the product is doing", () => {
    expectCodes(
      () =>
        validateStoryboard(
          withFirstScene((scene) => ({
            ...scene,
            shots: scene.shots.map((shot) => ({ ...shot, visualType: "PRODUCT_UI", productInteraction: "" })),
          })),
          base(),
        ),
      "STORYBOARD_SHOT_WITHOUT_INTERACTION",
    );
  });

  it("refuses a scene with nothing to make", () => {
    expectCodes(
      () => validateStoryboard(withFirstScene((scene) => ({ ...scene, shots: [] })), base()),
      "STORYBOARD_SCENE_WITHOUT_SHOTS",
    );
  });
});

describe("storyboard validator — reporting", () => {
  it("reports every problem at once, so one pass is enough to fix a draft", () => {
    const context = base();
    const board = makeStoryboard(context);
    const scenes = board.scenes.map((scene) => ({
      ...scene,
      featureIds: ["ft_missing"],
      claimIds: ["cl_missing"],
    }));
    const codes = codesFrom(() => validateStoryboard({ ...board, scenes }, context));
    expect(codes).toContain("STORYBOARD_UNKNOWN_FEATURE");
    expect(codes).toContain("STORYBOARD_UNKNOWN_CLAIM");
  });

  it("gives a verdict without throwing when the caller only wants a yes or no", () => {
    expect(isStoryboardValid(makeStoryboard(), base()).valid).toBe(true);

    const broken = makeStoryboard();
    const result = isStoryboardValid(
      { ...broken, scenes: broken.scenes.map((scene) => ({ ...scene, claimIds: ["nope"] })) },
      base(),
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe("STORYBOARD_UNKNOWN_CLAIM");
  });
});
