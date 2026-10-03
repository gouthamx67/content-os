import { describe, expect, it } from "vitest";
import {
  assertWithinRenderLimits,
  validateRendererContract,
} from "../validate-renderer-contract";
import { RenderContractError } from "../../errors";
import { RENDER_LIMITS } from "../../render-limits";

function rawLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: "l1",
    name: "layer",
    type: "SHAPE",
    assetRef: null,
    textContent: null,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
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

function rawContract(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    composition: {
      id: "vcomp_1",
      projectId: "project_1",
      canvas: { width: 100, height: 50, frameRate: 10, durationMs: 1000 },
      layers: [rawLayer()],
      ...overrides,
    },
  };
}

describe("validateRendererContract", () => {
  it("accepts a well-formed contract", () => {
    const result = validateRendererContract(rawContract());
    expect(result.composition.canvas.width).toBe(100);
    expect(result.composition.layers).toHaveLength(1);
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      validateRendererContract({ ...rawContract(), contractVersion: 2 }),
    ).toThrow(RenderContractError);
  });

  it("clamps opacity into [0,1]", () => {
    const result = validateRendererContract(
      rawContract({ layers: [rawLayer({ opacity: 5 })] }),
    );
    expect(result.composition.layers[0]!.opacity).toBe(1);
  });

  it("rejects a non-positive canvas dimension", () => {
    expect(() =>
      validateRendererContract(
        rawContract({
          canvas: { width: 0, height: 50, frameRate: 10, durationMs: 1000 },
        }),
      ),
    ).toThrow(RenderContractError);
  });

  it("rejects too many layers", () => {
    const layers = Array.from({ length: RENDER_LIMITS.maxLayers + 1 }, (_, index) =>
      rawLayer({ id: `l${index}` }),
    );
    expect(() => validateRendererContract(rawContract({ layers }))).toThrow(
      RenderContractError,
    );
  });

  it("rejects an invalid layer type", () => {
    expect(() =>
      validateRendererContract(
        rawContract({ layers: [rawLayer({ type: "SPRITE" })] }),
      ),
    ).toThrow(RenderContractError);
  });
});

describe("assertWithinRenderLimits", () => {
  it("passes a contract inside the limits", () => {
    expect(() =>
      assertWithinRenderLimits(validateRendererContract(rawContract())),
    ).not.toThrow();
  });

  it("rejects an oversized canvas", () => {
    const contract = validateRendererContract(rawContract());
    contract.composition.canvas.width = RENDER_LIMITS.maxWidth + 2;
    expect(() => assertWithinRenderLimits(contract)).toThrow(RenderContractError);
  });

  it("rejects an over-long duration", () => {
    const contract = validateRendererContract(rawContract());
    contract.composition.canvas.durationMs = RENDER_LIMITS.maxDurationMs + 1;
    expect(() => assertWithinRenderLimits(contract)).toThrow(RenderContractError);
  });

  it("rejects an over-high frame rate", () => {
    const contract = validateRendererContract(rawContract());
    contract.composition.canvas.frameRate = RENDER_LIMITS.maxFrameRate + 1;
    expect(() => assertWithinRenderLimits(contract)).toThrow(RenderContractError);
  });
});
