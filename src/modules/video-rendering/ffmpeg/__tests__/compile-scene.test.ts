import { describe, expect, it } from "vitest";
import type { RendererContract } from "../../../visual-motion-engine/export/renderer-contract";
import type { SceneGraphLayer } from "../../../visual-motion-engine/serialization/scene-graph";
import type { VisualLayerType } from "../../../visual-motion-engine/domain/types";
import { compileScene, escapeFilterPath } from "../compile-scene";
import { RenderFeatureError } from "../../errors";

function layer(
  overrides: Partial<SceneGraphLayer> & { id: string; type: VisualLayerType },
): SceneGraphLayer {
  return {
    name: overrides.id,
    assetRef: null,
    textContent: null,
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    rotation: 0,
    opacity: 1,
    fit: "CONTAIN",
    cropX: 0,
    cropY: 0,
    cropWidth: null,
    cropHeight: null,
    zIndex: 0,
    visible: true,
    keyframes: [],
    effects: [],
    ...overrides,
  };
}

function contract(layers: SceneGraphLayer[]): RendererContract {
  return {
    contractVersion: 1,
    composition: {
      id: "vcomp_1",
      projectId: "project_1",
      canvas: { width: 100, height: 50, frameRate: 10, durationMs: 1000 },
      layers,
    },
  };
}

describe("compileScene feature errors", () => {
  it("rejects group layers", () => {
    try {
      compileScene(contract([layer({ id: "g", type: "GROUP" })]), {
        assets: new Map(),
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderFeatureError);
      expect((error as RenderFeatureError).code).toBe("GROUP_LAYER_UNSUPPORTED");
    }
  });

  it("rejects a media layer without an asset reference", () => {
    try {
      compileScene(contract([layer({ id: "m", type: "MEDIA" })]), {
        assets: new Map(),
      });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RenderFeatureError).code).toBe("MEDIA_ASSET_MISSING");
    }
  });

  it("rejects an unresolved media asset", () => {
    try {
      compileScene(
        contract([layer({ id: "m", type: "MEDIA", assetRef: "capture:x" })]),
        { assets: new Map() },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RenderFeatureError).code).toBe("MEDIA_ASSET_UNRESOLVED");
    }
  });

  it("rejects text when no font is available", () => {
    try {
      compileScene(
        contract([layer({ id: "t", type: "TEXT", textContent: "hi" })]),
        { assets: new Map(), fontFile: null },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RenderFeatureError).code).toBe("NO_FONT_AVAILABLE");
    }
  });

  it("rejects text with no prepared source file", () => {
    try {
      compileScene(
        contract([layer({ id: "t", type: "TEXT", textContent: "hi" })]),
        { assets: new Map(), fontFile: "/tmp/font.ttf" },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect((error as RenderFeatureError).code).toBe("TEXT_SOURCE_MISSING");
    }
  });
});

describe("compileScene output", () => {
  it("compiles a text layer into a drawtext / overlay graph", () => {
    const result = compileScene(
      contract([layer({ id: "t", type: "TEXT", textContent: "hi" })]),
      {
        assets: new Map(),
        fontFile: "/tmp/font.ttf",
        textFiles: new Map([["t", "/tmp/text-t.txt"]]),
      },
    );

    expect(result.filterComplex).toContain("drawtext=fontfile=/tmp/font.ttf");
    expect(result.filterComplex).toContain("overlay=");
    expect(result.filterComplex).toContain("[outv]");
    expect(result.outputLabel).toBe("outv");
    expect(result.outputArgs).toContain("libx264");
    expect(result.outputArgs).toContain("yuv420p");
    expect(result.totalFrames).toBe(10);
    expect(result.outputDurationSec).toBe(1);
  });

  it("pads odd dimensions up to even", () => {
    const scene = contract([layer({ id: "s", type: "SHAPE" })]);
    scene.composition.canvas.width = 101;
    scene.composition.canvas.height = 51;

    const result = compileScene(scene, { assets: new Map() });
    expect(result.filterComplex).toContain("trunc(iw/2)*2");
  });

  it("compiles an animated opacity into geq", () => {
    const result = compileScene(
      contract([
        layer({
          id: "s",
          type: "SHAPE",
          keyframes: [
            {
              id: "k1",
              property: "OPACITY",
              timeMs: 0,
              fromValue: 0,
              toValue: 1,
              easing: "LINEAR",
            },
          ],
        }),
      ]),
      { assets: new Map() },
    );

    expect(result.filterComplex).toContain("geq=");
  });
});

describe("escapeFilterPath", () => {
  it("escapes filtergraph punctuation", () => {
    expect(escapeFilterPath("/a:b,c")).toBe("/a\\:b\\,c");
  });
});
