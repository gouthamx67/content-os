import { describe, expect, it } from "vitest";
import { fitRect } from "../layout/fit";

describe("fitRect", () => {
  it("letterboxes a wide source inside a tall box (CONTAIN)", () => {
    const rect = fitRect({
      sourceWidth: 200,
      sourceHeight: 100,
      boxWidth: 100,
      boxHeight: 100,
      mode: "CONTAIN",
    });

    expect(rect.scale).toBeCloseTo(0.5);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(50);
    expect(rect.offsetY).toBeCloseTo(25);
    expect(rect.offsetX).toBeCloseTo(0);
  });

  it("crops a wide source inside a tall box (COVER)", () => {
    const rect = fitRect({
      sourceWidth: 200,
      sourceHeight: 100,
      boxWidth: 100,
      boxHeight: 100,
      mode: "COVER",
    });

    expect(rect.scale).toBeCloseTo(1);
    expect(rect.width).toBeCloseTo(200);
    expect(rect.height).toBeCloseTo(100);
    expect(rect.offsetX).toBeCloseTo(-50);
  });

  it("fills the box for STRETCH", () => {
    const rect = fitRect({
      sourceWidth: 200,
      sourceHeight: 100,
      boxWidth: 50,
      boxHeight: 80,
      mode: "STRETCH",
    });

    expect(rect).toEqual({
      width: 50,
      height: 80,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    });
  });

  it("degrades a zero-sized source to an empty rect", () => {
    const rect = fitRect({
      sourceWidth: 0,
      sourceHeight: 100,
      boxWidth: 100,
      boxHeight: 100,
      mode: "CONTAIN",
    });

    expect(rect.scale).toBe(0);
    expect(rect.width).toBe(100);
    expect(Number.isFinite(rect.offsetX)).toBe(true);
  });
});
