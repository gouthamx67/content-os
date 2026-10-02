import { describe, expect, it } from "vitest";
import {
  VISUAL_RENDERER_CONTRACT_VERSION,
  buildRendererScene,
} from "../export/renderer-contract";
import { makeComposition, makeKeyframe, makeLayer } from "./fixtures";

describe("buildRendererScene", () => {
  it("stamps the contract version and composition identity", () => {
    const scene = buildRendererScene(
      makeComposition({ id: "comp_9", projectId: "proj_9" }),
      0,
    );

    expect(scene.contractVersion).toBe(VISUAL_RENDERER_CONTRACT_VERSION);
    expect(scene.compositionId).toBe("comp_9");
    expect(scene.projectId).toBe("proj_9");
  });

  it("carries evaluated transforms, not raw layer values", () => {
    const scene = buildRendererScene(
      makeComposition({
        durationMs: 1000,
        layers: [
          makeLayer({
            x: 0,
            width: 100,
            keyframes: [
              makeKeyframe({
                property: "SCALE",
                timeMs: 0,
                fromValue: 1,
                toValue: 2,
              }),
            ],
          }),
        ],
      }),
      1000,
    );

    expect(scene.layers[0]!.transform.width).toBe(200);
    expect(scene.layers[0]!.transform).toHaveProperty("opacity");
  });

  it("does not leak storage keys", () => {
    const scene = buildRendererScene(
      makeComposition({
        layers: [makeLayer({ type: "MEDIA", assetRef: "capture:take_1" })],
      }),
      0,
    );

    expect(JSON.stringify(scene)).not.toContain("storageKey");
    expect(scene.layers[0]!.assetRef).toBe("capture:take_1");
  });
});
