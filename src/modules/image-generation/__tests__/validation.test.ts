import { describe, expect, it } from "vitest";
import {
  MAX_ELEMENTS,
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  validateDesignGraph,
  validateGenerationRequest,
} from "../domain/validation";
import type {
  GraphicDesignGraph,
  ImageGenerationRequest,
} from "../domain/types";
import { ImageGenerationError } from "../errors";
import { sampleGraph } from "./fixtures";

function request(
  overrides: Partial<ImageGenerationRequest> = {},
): ImageGenerationRequest {
  return {
    projectId: "project_1",
    requestedById: "user_1",
    templateType: "PRODUCT_HERO",
    prompt: "Announce storyboards",
    width: 1080,
    height: 1080,
    outputFormat: "PNG",
    transparent: false,
    ...overrides,
  };
}

describe("validateGenerationRequest", () => {
  it("accepts a well-formed request", () => {
    expect(() => validateGenerationRequest(request())).not.toThrow();
  });

  it("rejects an unknown template", () => {
    expect(() =>
      validateGenerationRequest(
        request({ templateType: "NOPE" as ImageGenerationRequest["templateType"] }),
      ),
    ).toThrowError(ImageGenerationError);
  });

  it("rejects an empty prompt", () => {
    expect(() => validateGenerationRequest(request({ prompt: "   " }))).toThrow(
      /prompt is required/i,
    );
  });

  it("rejects a prompt over the length limit", () => {
    expect(() =>
      validateGenerationRequest(request({ prompt: "x".repeat(5000) })),
    ).toThrow(/exceeds/i);
  });

  it("rejects a width over the canvas limit", () => {
    expect(() =>
      validateGenerationRequest(request({ width: MAX_IMAGE_WIDTH + 1 })),
    ).toThrow(/Width/i);
  });

  it("rejects a height over the canvas limit", () => {
    expect(() =>
      validateGenerationRequest(request({ height: MAX_IMAGE_HEIGHT + 1 })),
    ).toThrow(/Height/i);
  });

  it("rejects a non-integer dimension", () => {
    expect(() =>
      validateGenerationRequest(request({ width: 10.5 })),
    ).toThrow(/Width/i);
  });

  it("rejects transparent JPEG instead of silently flattening it", () => {
    expect(() =>
      validateGenerationRequest(
        request({ outputFormat: "JPEG", transparent: true }),
      ),
    ).toThrow(/transparency/i);
  });
});

describe("validateDesignGraph", () => {
  it("accepts the sample graph", () => {
    expect(() => validateDesignGraph(sampleGraph())).not.toThrow();
  });

  it("rejects a graph with no elements", () => {
    expect(() =>
      validateDesignGraph(sampleGraph({ elements: [] })),
    ).toThrow(/at least one element/i);
  });

  it("rejects duplicate element ids", () => {
    const graph: GraphicDesignGraph = sampleGraph();
    graph.elements = [
      graph.elements[0]!,
      { ...graph.elements[0]!, zIndex: 2, y: 0 },
    ];
    expect(() => validateDesignGraph(graph)).toThrow(/Duplicate/i);
  });

  it("rejects an element outside the canvas", () => {
    const graph: GraphicDesignGraph = sampleGraph();
    graph.elements = [{ ...graph.elements[0]!, x: 399, width: 100 }];
    expect(() => validateDesignGraph(graph)).toThrow(/beyond the design bounds/i);
  });

  it("rejects too many elements", () => {
    const graph: GraphicDesignGraph = sampleGraph();
    graph.elements = Array.from({ length: MAX_ELEMENTS + 1 }, (_, index) => ({
      id: `el_${index}`,
      type: "RECT" as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      zIndex: index,
    }));
    expect(() => validateDesignGraph(graph)).toThrow(/may not exceed/i);
  });

  it("rejects an image element without a reference", () => {
    const graph: GraphicDesignGraph = sampleGraph();
    graph.elements = [
      {
        id: "img",
        type: "IMAGE",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        zIndex: 0,
      },
    ];
    expect(() => validateDesignGraph(graph)).toThrow(/assetRef/i);
  });

  it("rejects an unsupported contract version", () => {
    const graph = { ...sampleGraph(), contractVersion: 2 } as unknown as GraphicDesignGraph;
    expect(() => validateDesignGraph(graph)).toThrow(/contract version/i);
  });
});
