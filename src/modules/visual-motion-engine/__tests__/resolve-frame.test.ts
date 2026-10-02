import { describe, expect, it } from "vitest";
import { evaluateScene, frameTimes, findLayerFrame } from "../motion/evaluate-scene";
import { makeComposition, makeEffect, makeKeyframe, makeLayer } from "./fixtures";

describe("resolveFrame", () => {
  it("leaves a layer with no motion at rest", () => {
    const frame = evaluateScene(
      makeComposition({ layers: [makeLayer({ x: 10, y: 20, opacity: 0.8 })] }),
      500,
    );

    const layer = frame.layers[0]!;
    expect(layer.x).toBe(10);
    expect(layer.y).toBe(20);
    expect(layer.opacity).toBeCloseTo(0.8);
  });

  it("applies motion as deltas on the base transform", () => {
    const frame = evaluateScene(
      makeComposition({
        durationMs: 1000,
        layers: [
          makeLayer({
            x: 100,
            y: 50,
            width: 200,
            height: 200,
            opacity: 0.5,
            keyframes: [
              makeKeyframe({
                property: "X",
                timeMs: 0,
                fromValue: 0,
                toValue: 100,
              }),
              makeKeyframe({
                property: "Y",
                timeMs: 0,
                fromValue: 0,
                toValue: 20,
              }),
              makeKeyframe({
                property: "SCALE",
                timeMs: 0,
                fromValue: 1,
                toValue: 2,
              }),
              makeKeyframe({
                property: "OPACITY",
                timeMs: 0,
                fromValue: 1,
                toValue: 1,
              }),
            ],
          }),
        ],
      }),
      1000,
    );

    const layer = frame.layers[0]!;
    expect(layer.x).toBe(200);
    expect(layer.y).toBe(70);
    expect(layer.width).toBe(400);
    expect(layer.height).toBe(400);
    expect(layer.opacity).toBeCloseTo(0.5);
  });

  it("clamps multiplied opacity to the unit range", () => {
    const frame = evaluateScene(
      makeComposition({
        durationMs: 1000,
        layers: [
          makeLayer({
            opacity: 0.8,
            keyframes: [
              makeKeyframe({
                property: "OPACITY",
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

    expect(frame.layers[0]!.opacity).toBe(1);
  });

  it("sorts layers by zIndex and filters disabled effects", () => {
    const frame = evaluateScene(
      makeComposition({
        layers: [
          makeLayer({ id: "b", zIndex: 5 }),
          makeLayer({ id: "a", zIndex: 1, effects: [
            makeEffect({ type: "BLUR", amount: 2, enabled: true }),
            makeEffect({ type: "CONTRAST", amount: 3, enabled: false }),
          ] }),
        ],
      }),
      0,
    );

    expect(frame.layers.map((layer) => layer.id)).toEqual(["a", "b"]);
    expect(frame.layers[0]!.effects).toEqual([{ type: "BLUR", amount: 2 }]);
  });

  it("clamps time to the composition duration", () => {
    const frame = evaluateScene(makeComposition({ durationMs: 1000 }), 5000);
    expect(frame.timeMs).toBe(1000);
  });
});

describe("frameTimes", () => {
  it("is inclusive of both ends", () => {
    const times = frameTimes(makeComposition({ durationMs: 1000, frameRate: 10 }));
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(1000);
    expect(times.length).toBe(11);
  });
});

describe("findLayerFrame", () => {
  it("returns null for an unknown layer", () => {
    const frame = evaluateScene(makeComposition(), 0);
    expect(findLayerFrame(frame, "nope")).toBeNull();
  });
});
