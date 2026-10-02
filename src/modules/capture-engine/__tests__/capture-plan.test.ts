import { describe, expect, it } from "vitest";
import { buildCapturePlan, modesForPlanItem } from "../capture-plan";

describe("buildCapturePlan", () => {
  it("reads shot requirements rather than inventing them", () => {
    const plan = buildCapturePlan([
      {
        id: "shot-1",
        title: "Open",
        captureRequirements: {
          modes: ["CAMERA"],
          instructions: ["Face the camera", "Hold for two seconds"],
          required: true,
        },
      },
    ]);

    expect(plan).toEqual([
      {
        shotId: "shot-1",
        shotTitle: "Open",
        requiredModes: ["CAMERA"],
        instructions: ["Face the camera", "Hold for two seconds"],
        required: true,
      },
    ]);
  });

  it("keeps a shot with no requirements capturable but not demanded", () => {
    const plan = buildCapturePlan([{ id: "shot-2", title: "Untitled" }]);

    expect(plan[0]?.required).toBe(false);
    expect(plan[0]?.requiredModes).toEqual([]);
    expect(plan[0]?.instructions).toEqual([]);
  });

  it("drops modes the engine cannot honour", () => {
    const plan = buildCapturePlan([
      {
        id: "shot-3",
        title: "Mixed",
        captureRequirements: {
          modes: ["CAMERA", "HOLOGRAM", "SCREEN"],
          instructions: [],
        },
      },
    ]);

    expect(plan[0]?.requiredModes).toEqual(["CAMERA", "SCREEN"]);
  });

  it("preserves storyboard order", () => {
    const plan = buildCapturePlan([
      { id: "b", title: "Second" },
      { id: "a", title: "First" },
    ]);

    expect(plan.map((item) => item.shotId)).toEqual(["b", "a"]);
  });
});

describe("modesForPlanItem", () => {
  it("offers the required modes when a shot named them", () => {
    const plan = buildCapturePlan([
      {
        id: "shot-1",
        title: "Open",
        captureRequirements: { modes: ["MICROPHONE"], instructions: [] },
      },
    ]);

    expect(modesForPlanItem(plan[0]!)).toEqual(["MICROPHONE"]);
  });

  it("offers every mode when a shot expressed no preference", () => {
    const plan = buildCapturePlan([{ id: "shot-2", title: "Anything" }]);

    expect(modesForPlanItem(plan[0]!)).toEqual([
      "CAMERA",
      "MICROPHONE",
      "SCREEN",
      "FILE",
    ]);
  });
});
