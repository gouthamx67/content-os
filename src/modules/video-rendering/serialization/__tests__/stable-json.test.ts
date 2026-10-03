import { describe, expect, it } from "vitest";
import { stableStringify } from "../stable-json";
import { hashScene } from "../hash-scene";
import type { RendererContract } from "../../../visual-motion-engine/export/renderer-contract";

describe("stableStringify", () => {
  it("sorts keys so insertion order does not matter", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes nested structures deterministically", () => {
    const left = { z: [{ y: 1, x: 2 }], a: true };
    const right = { a: true, z: [{ x: 2, y: 1 }] };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it("rejects non-finite numbers", () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow();
  });
});

describe("hashScene", () => {
  it("returns a stable sha256 regardless of key order", () => {
    const base = {
      contractVersion: 1,
      composition: {
        id: "vcomp_1",
        projectId: "project_1",
        canvas: { width: 100, height: 50, frameRate: 10, durationMs: 1000 },
        layers: [],
      },
    } as RendererContract;

    const reordered = {
      contractVersion: 1,
      composition: {
        id: "vcomp_1",
        projectId: "project_1",
        canvas: { durationMs: 1000, frameRate: 10, height: 50, width: 100 },
        layers: [],
      },
    } as RendererContract;

    expect(hashScene(base)).toBe(hashScene(reordered));
    expect(hashScene(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
