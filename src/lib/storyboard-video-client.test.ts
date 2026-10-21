import { describe, expect, it, vi } from "vitest";
import {
  generateStoryboardVideo,
  StoryboardVideoRequestError,
} from "./storyboard-video-client";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function plan() {
  return {
    composition: {
      name: "Launch video",
      width: 1080,
      height: 1920,
      frameRate: 30,
      durationMs: 8_000,
    },
    layers: [
      {
        name: "Text backdrop",
        type: "SHAPE" as const,
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
        zIndex: 2,
        opacity: 0.62,
      },
      {
        name: "Scene · Hook",
        type: "TEXT" as const,
        textContent: "Hook\nStart here",
        x: 86,
        y: 900,
        width: 908,
        height: 120,
        zIndex: 3,
        keyframes: [
          {
            property: "OPACITY" as const,
            timeMs: 0,
            fromValue: 1,
            toValue: 1,
            easing: "LINEAR" as const,
          },
          {
            property: "OPACITY" as const,
            timeMs: 3_850,
            fromValue: 1,
            toValue: 0,
            easing: "EASE_OUT" as const,
          },
        ],
      },
    ],
  };
}

describe("generateStoryboardVideo", () => {
  it("creates the composition, layers, keyframes and returns the MP4", async () => {
    let layerCounter = 0;
    let pollCounter = 0;
    const calls: Array<{ url: string; method: string }> = [];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });

      if (url.endsWith("/visual/compositions") && init?.method === "POST") {
        return response({ composition: { id: "vcomp_1" } }, 201);
      }
      if (url.endsWith("/layers") && init?.method === "POST") {
        layerCounter += 1;
        return response(
          { composition: { layers: [{ id: `layer_${layerCounter}` }] } },
          201,
        );
      }
      if (url.endsWith("/keyframes") && init?.method === "POST") {
        return response({ composition: {} }, 201);
      }
      if (url.endsWith("/render") && init?.method === "POST") {
        return response({
          renderJob: {
            id: "rjob_1",
            status: "QUEUED",
            progressPct: 0,
            errorMessage: null,
          },
        }, 201);
      }
      if (url.endsWith("/renders/rjob_1")) {
        pollCounter += 1;
        if (pollCounter === 1) {
          return response({
            renderJob: {
              id: "rjob_1",
              status: "RUNNING",
              progressPct: 50,
              errorMessage: null,
            },
            artifact: null,
          });
        }
        return response({
          renderJob: {
            id: "rjob_1",
            status: "SUCCEEDED",
            progressPct: 100,
            errorMessage: null,
          },
          artifact: { downloadUrl: "/api/projects/prj_1/renders/rjob_1/stream" },
        });
      }

      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });

    const result = await generateStoryboardVideo({
      projectId: "prj_1",
      plan: plan(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      pollIntervalMs: 0,
    });

    expect(result).toEqual({
      compositionId: "vcomp_1",
      renderJobId: "rjob_1",
      downloadUrl: "/api/projects/prj_1/renders/rjob_1/stream",
    });

    expect(calls.map((call) => call.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "GET",
      "GET",
    ]);
    expect(calls[1]!.url).toBe(
      "/api/projects/prj_1/visual/compositions/vcomp_1/layers",
    );
    expect(calls[3]!.url).toContain("layer_2/keyframes");

    const layerBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/layers"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(layerBodies[0]).not.toHaveProperty("keyframes");
    expect(layerBodies[1].textContent).toContain("Start here");

    const keyframeBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/keyframes"))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(keyframeBodies).toHaveLength(2);
    expect(keyframeBodies[1]).toMatchObject({
      property: "OPACITY",
      timeMs: 3_850,
      fromValue: 1,
      toValue: 0,
    });
  });

  it("surfaces a failed render instead of pretending it succeeded", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/visual/compositions")) {
        return response({ composition: { id: "vcomp_1" } }, 201);
      }
      if (url.endsWith("/layers")) {
        return response(
          { composition: { layers: [{ id: "layer_1" }] } },
          201,
        );
      }
      if (url.endsWith("/keyframes")) {
        return response({ composition: {} }, 201);
      }
      if (url.endsWith("/render") && init?.method === "POST") {
        return response({
          renderJob: {
            id: "rjob_1",
            status: "QUEUED",
            progressPct: 0,
            errorMessage: null,
          },
        });
      }
      return response({
        renderJob: {
          id: "rjob_1",
          status: "FAILED",
          progressPct: 100,
          errorMessage: "ffmpeg exited with code 1",
        },
        artifact: null,
      });
    });

    await expect(
      generateStoryboardVideo({
        projectId: "prj_1",
        plan: plan(),
        fetchImpl: fetchMock as unknown as typeof fetch,
        pollIntervalMs: 0,
      }),
    ).rejects.toEqual(
      new StoryboardVideoRequestError("ffmpeg exited with code 1"),
    );
  });
});
