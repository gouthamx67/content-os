import { describe, expect, it } from "vitest";
import { sanitizeMessage } from "../render-worker";
import { RenderWorkerHealth } from "../worker-health";

describe("sanitizeMessage", () => {
  it("collapses whitespace and strips absolute paths", () => {
    const message =
      "ffmpeg failed at /home/user/secret/dir/input.mp4:\n  invalid data";
    const sanitized = sanitizeMessage(message);

    expect(sanitized).not.toContain("/home/user/secret");
    expect(sanitized).toContain("<path>");
    expect(sanitized).not.toContain("\n");
  });

  it("truncates long diagnostics", () => {
    expect(sanitizeMessage("x".repeat(1000))).toHaveLength(400);
  });
});

describe("RenderWorkerHealth", () => {
  it("tracks job outcomes", () => {
    const health = new RenderWorkerHealth();
    health.markStarted();
    health.markJobStarted("render_1");
    health.markJobFinished("SUCCEEDED");
    health.markJobFinished("FAILED");
    health.markJobFinished("CANCELLED");

    const snapshot = health.snapshot();
    expect(snapshot.running).toBe(true);
    expect(snapshot.processed).toBe(1);
    expect(snapshot.succeeded).toBe(1);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.cancelled).toBe(1);
    expect(snapshot.currentJobId).toBeNull();
  });

  it("clears the current job on stop", () => {
    const health = new RenderWorkerHealth();
    health.markStarted();
    health.markJobStarted("render_1");
    health.markStopped();

    const snapshot = health.snapshot();
    expect(snapshot.running).toBe(false);
    expect(snapshot.currentJobId).toBeNull();
  });
});
