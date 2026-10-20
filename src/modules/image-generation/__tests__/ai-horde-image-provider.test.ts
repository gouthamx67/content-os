import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { inspectImage } from "../artifact/image-metadata";
import { verifyGeneratedImage } from "../artifact/verify-image";
import type { GraphicDesignGraph } from "../domain/types";
import {
  AI_HORDE_ANONYMOUS_KEY,
  AI_HORDE_PROVIDER_VERSION,
  aiHordeConfigFromEnv,
  createAiHordeImageProvider,
  hordeSizeFor,
} from "../providers/ai-horde-image-provider";
import { IMAGE_PROVIDER_CHAIN_VERSION } from "../providers/image-provider-chain";
import { getImageProvider } from "../providers/registry";
import { REMOTE_IMAGE_PROVIDER_VERSION } from "../providers/remote-image-provider";

function graph(overrides: Partial<GraphicDesignGraph> = {}): GraphicDesignGraph {
  return {
    contractVersion: 1,
    width: 400,
    height: 300,
    background: { kind: "COLOR", color: "#101828" },
    elements: [
      {
        id: "text_1",
        type: "TEXT",
        x: 20,
        y: 20,
        width: 300,
        height: 60,
        zIndex: 1,
        text: "Ship faster",
        style: { fill: "#f2f4f7", fontSize: 32 },
      },
    ],
    ...overrides,
  };
}

async function pngBytes(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const config = {
  baseUrl: "https://aihorde.example.com",
  apiKey: AI_HORDE_ANONYMOUS_KEY,
  model: null,
  steps: 20,
  timeoutMs: 5_000,
  pollIntervalMs: 5,
};

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(route: Route) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => route(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function happyRoute(bytes: Buffer, checks: Array<{ done: boolean }> = [{ done: true }]) {
  let checkCount = 0;
  return (url: string, init?: RequestInit): Response => {
    if (url.endsWith("/api/v2/generate/async")) return json({ id: "job_1" });
    if (url.includes("/api/v2/generate/check/job_1")) {
      const state = checks[Math.min(checkCount, checks.length - 1)];
      checkCount += 1;
      return json({ done: state?.done ?? true, faulted: false });
    }
    if (url.includes("/api/v2/generate/status/job_1")) {
      return json({
        generations: [{ img: "https://cdn.example.com/out.png", model: "stable_diffusion" }],
      });
    }
    if (url === "https://cdn.example.com/out.png") {
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return json({ detail: "unexpected" }, 404);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["IMAGE_HORDE_BASE_URL"];
  delete process.env["IMAGE_HORDE_API_KEY"];
  delete process.env["IMAGE_HORDE_MODEL"];
  delete process.env["IMAGE_HORDE_TIMEOUT_MS"];
  delete process.env["IMAGE_LLM_BASE_URL"];
  delete process.env["IMAGE_LLM_MODEL"];
  delete process.env["IMAGE_LLM_BASE_URL"];
  delete process.env["IMAGE_POLLINATIONS_BASE_URL"];
});

describe("aiHordeConfigFromEnv", () => {
  it("requires a base URL and defaults to the anonymous key", () => {
    expect(aiHordeConfigFromEnv({})).toBeNull();
    expect(aiHordeConfigFromEnv({ IMAGE_HORDE_BASE_URL: "https://aihorde.net/" })).toEqual({
      baseUrl: "https://aihorde.net",
      apiKey: AI_HORDE_ANONYMOUS_KEY,
      model: null,
      steps: 20,
      timeoutMs: 240_000,
      pollIntervalMs: 4_000,
    });
  });

  it("reads overrides and keeps the step count bounded", () => {
    expect(
      aiHordeConfigFromEnv({
        IMAGE_HORDE_BASE_URL: "https://horde.example.com",
        IMAGE_HORDE_API_KEY: "registered-key",
        IMAGE_HORDE_MODEL: "stable_diffusion",
        IMAGE_HORDE_STEPS: "80",
        IMAGE_HORDE_TIMEOUT_MS: "9000",
        IMAGE_HORDE_POLL_MS: "250",
      }),
    ).toEqual({
      baseUrl: "https://horde.example.com",
      apiKey: "registered-key",
      model: "stable_diffusion",
      steps: 50,
      timeoutMs: 9_000,
      pollIntervalMs: 250,
    });
  });
});

describe("hordeSizeFor", () => {
  it("maps aspect and scale to sizes the fleet serves", () => {
    expect(hordeSizeFor(512, 512)).toEqual({ width: 512, height: 512 });
    expect(hordeSizeFor(400, 300)).toEqual({ width: 512, height: 384 });
    expect(hordeSizeFor(400, 600)).toEqual({ width: 384, height: 512 });
    expect(hordeSizeFor(1024, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(hordeSizeFor(1080, 1350)).toEqual({ width: 768, height: 1024 });
    expect(hordeSizeFor(1600, 900)).toEqual({ width: 1024, height: 768 });
  });
});

describe("registry selection", () => {
  it("uses AI Horde when its endpoint is configured", () => {
    process.env["IMAGE_HORDE_BASE_URL"] = "https://aihorde.example.com";
    expect(getImageProvider("REMOTE_IMAGE").version).toBe(AI_HORDE_PROVIDER_VERSION);
  });

  it("falls back from the paid endpoint to AI Horde", () => {
    process.env["IMAGE_HORDE_BASE_URL"] = "https://aihorde.example.com";
    process.env["IMAGE_LLM_BASE_URL"] = "https://images.example.com/v1";
    process.env["IMAGE_LLM_MODEL"] = "gpt-image-1";
    expect(getImageProvider("REMOTE_IMAGE").version).toBe(
      IMAGE_PROVIDER_CHAIN_VERSION,
    );
  });

  it("stays on the explicit hole when nothing is configured", () => {
    expect(getImageProvider("REMOTE_IMAGE").version).toBe(
      REMOTE_IMAGE_PROVIDER_VERSION,
    );
  });
});

describe("AI Horde image provider", () => {
  it("submits a job, polls it, downloads and normalizes the result", async () => {
    const fetchMock = mockFetch(happyRoute(await pngBytes()));

    const result = await createAiHordeImageProvider(config).generate({
      graph: graph(),
      width: 400,
      height: 300,
      format: "PNG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(submitUrl).toBe("https://aihorde.example.com/api/v2/generate/async");
    expect(submitInit.method).toBe("POST");
    const headers = submitInit.headers as Record<string, string>;
    expect(headers["apikey"]).toBe(AI_HORDE_ANONYMOUS_KEY);
    expect(headers["client-agent"]).toBe("content-os:1.0");
    const body = JSON.parse(String(submitInit.body)) as {
      prompt: string;
      params: { width: number; height: number; steps: number; n: number; models?: string[] };
    };
    expect(body.prompt).toContain('"Ship faster"');
    expect(body.prompt).toContain("#101828");
    expect(body.params).toMatchObject({
      width: 512,
      height: 384,
      steps: 20,
      n: 1,
    });
    expect(body.params.models).toBeUndefined();

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.includes("/api/v2/generate/check/job_1"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/v2/generate/status/job_1"))).toBe(true);
    expect(urls).toContain("https://cdn.example.com/out.png");

    expect(result.providerJobId).toBe("job_1");
    expect(result.providerModel).toBe("stable_diffusion");
    expect(result.providerVersion).toBe(AI_HORDE_PROVIDER_VERSION);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.mimeType).toBe("image/png");

    const metadata = await inspectImage(result.bytes);
    await verifyGeneratedImage({
      bytes: result.bytes,
      metadata,
      expected: { width: 400, height: 300, format: "PNG", transparent: false },
    });
  });

  it("asks for a named model and polls more than once when the job is queued", async () => {
    const fetchMock = mockFetch(
      happyRoute(await pngBytes(), [{ done: false }, { done: true }]),
    );

    await createAiHordeImageProvider({ ...config, model: "stable_diffusion" }).generate({
      graph: graph(),
      width: 400,
      height: 300,
      format: "PNG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    const submit = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(submit[1].body)) as { params: { models?: string[] } };
    expect(body.params.models).toEqual(["stable_diffusion"]);

    const checks = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/generate/check/"),
    );
    expect(checks).toHaveLength(2);
  });

  it("converts to JPEG when the recipe asks for it", async () => {
    mockFetch(happyRoute(await pngBytes()));

    const result = await createAiHordeImageProvider(config).generate({
      graph: graph(),
      width: 400,
      height: 300,
      format: "JPEG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    expect(result.mimeType).toBe("image/jpeg");
    const metadata = await inspectImage(result.bytes);
    expect(metadata.format.toLowerCase()).toBe("jpeg");
  });

  it("reports a faulted job without pretending it produced an image", async () => {
    mockFetch((url) => {
      if (url.endsWith("/async")) return json({ id: "job_1" });
      return json({ done: false, faulted: true });
    });

    await expect(
      createAiHordeImageProvider(config).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow("AI Horde provider (aihorde.example.com) reported the job as faulted");
  });

  it("gives up early when no worker can serve the request", async () => {
    mockFetch((url) => {
      if (url.endsWith("/async")) return json({ id: "job_1" });
      return json({ done: false, is_possible: false });
    });

    await expect(
      createAiHordeImageProvider(config).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow("has no worker for this request");
  });

  it("times out instead of polling forever", async () => {
    mockFetch((url) => {
      if (url.endsWith("/async")) return json({ id: "job_1" });
      return json({ done: false, faulted: false });
    });

    await expect(
      createAiHordeImageProvider({
        ...config,
        timeoutMs: 80,
        pollIntervalMs: 10,
      }).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow("timed out");
  });

  it("sanitizes a rejected submission", async () => {
    mockFetch(() => json({ detail: "forbidden" }, 403));

    await expect(
      createAiHordeImageProvider(config).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow(
      "AI Horde provider (aihorde.example.com) request failed (HTTP 403)",
    );
  });

  it("refuses a non-https image URL", async () => {
    mockFetch((url) => {
      if (url.endsWith("/async")) return json({ id: "job_1" });
      if (url.includes("/check/")) return json({ done: true });
      return json({ generations: [{ img: "http://cdn.example.com/out.png" }] });
    });

    await expect(
      createAiHordeImageProvider(config).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow("AI Horde provider returned a non-https download URL");
  });

  it("rejects undecodable bytes instead of storing them", async () => {
    mockFetch(happyRoute(Buffer.from("not an image")));

    await expect(
      createAiHordeImageProvider(config).generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toThrow("AI Horde provider returned undecodable image data");
  });
});
