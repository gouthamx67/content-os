import { describe, expect, it } from "vitest";
import {
  applyMotion,
  easingExpression,
  escapeDrawtext,
  ffmpegNumber,
  keyframesToFfmpegExpr,
} from "../expressions";
import type { SceneGraphKeyframe } from "../../../visual-motion-engine/serialization/scene-graph";

function keyframe(
  overrides: Partial<SceneGraphKeyframe> & { id: string },
): SceneGraphKeyframe {
  return {
    property: "X",
    timeMs: 0,
    fromValue: 0,
    toValue: 100,
    easing: "LINEAR",
    ...overrides,
  } as SceneGraphKeyframe;
}

describe("ffmpegNumber", () => {
  it("renders integers without a decimal point", () => {
    expect(ffmpegNumber(10)).toBe("10");
    expect(ffmpegNumber(-4)).toBe("-4");
  });

  it("normalizes negative zero", () => {
    expect(ffmpegNumber(-0)).toBe("0");
  });

  it("trims trailing zeros from fractions", () => {
    expect(ffmpegNumber(1.5)).toBe("1.5");
    expect(ffmpegNumber(0.25)).toBe("0.25");
  });

  it("rejects non-finite input", () => {
    expect(() => ffmpegNumber(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("easingExpression", () => {
  it("maps each easing to its curve", () => {
    expect(easingExpression("p", "LINEAR")).toBe("(p)");
    expect(easingExpression("p", "EASE_IN")).toBe("(p)*(p)");
    expect(easingExpression("p", "EASE_OUT")).toBe("(p)*(2-(p))");
    expect(easingExpression("p", "EASE_IN_OUT")).toContain("if(lt(");
  });
});

describe("keyframesToFfmpegExpr", () => {
  it("collapses an all-equal track to a constant", () => {
    const result = keyframesToFfmpegExpr(
      [
        keyframe({ id: "a", fromValue: 5, toValue: 5 }),
        keyframe({ id: "b", timeMs: 500, fromValue: 5, toValue: 5 }),
      ],
      1000,
    );

    expect(result.constant).toBe(true);
    expect(result.value).toBe(5);
  });

  it("builds a conditional expression for a moving track", () => {
    const result = keyframesToFfmpegExpr(
      [keyframe({ id: "a", timeMs: 0, fromValue: 0, toValue: 100 })],
      1000,
    );

    expect(result.constant).toBe(false);
    expect(result.expression).toContain("if(lt(t,");
    expect(result.expression).toContain("t-0");
  });

  it("uses the provided time variable", () => {
    const result = keyframesToFfmpegExpr(
      [keyframe({ id: "a", timeMs: 0, fromValue: 0, toValue: 100 })],
      1000,
      "T",
    );

    expect(result.expression).toContain("lt(T,");
  });

  it("treats a zero-length segment as a step", () => {
    const result = keyframesToFfmpegExpr(
      [
        keyframe({ id: "a", timeMs: 0, fromValue: 0, toValue: 0 }),
        keyframe({ id: "b", timeMs: 0, fromValue: 0, toValue: 50 }),
      ],
      1000,
    );

    expect(result.constant).toBe(false);
    expect(result.expression).toContain("if(lt(t,0)");
  });
});

describe("applyMotion", () => {
  it("adds translation deltas", () => {
    const moved = applyMotion(10, "X", { expression: "20", constant: true, value: 20 });
    expect(moved.value).toBe(30);
    expect(moved.constant).toBe(true);
  });

  it("multiplies scale deltas", () => {
    const scaled = applyMotion(100, "SCALE", {
      expression: "2",
      constant: true,
      value: 2,
    });
    expect(scaled.value).toBe(200);
  });

  it("keeps an animated delta as an expression", () => {
    const animated = applyMotion(10, "X", {
      expression: "t*2",
      constant: false,
      value: 0,
    });
    expect(animated.constant).toBe(false);
    expect(animated.expression).toBe("(10+(t*2))");
  });
});

describe("escapeDrawtext", () => {
  it("escapes graph and format punctuation", () => {
    expect(escapeDrawtext("a:b,c'd%[e]")).toBe("a\\:b\\,c\\'d\\%\\[e\\]");
  });
});
