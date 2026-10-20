import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { GraphicDesignGraph } from "../domain/types";
import {
  POLLINATIONS_IMAGE_PROVIDER_VERSION,
  createPollinationsImageProvider,
  pollinationsConfigFromEnv,
} from "../providers/pollinations-image-provider";

function graph(): GraphicDesignGraph {
  return {
    contractVersion: 1,
    width: 512,
    height: 512,
    background: { kind: "COLOR", color: "#101828" },
    elements: [
      {
        id: "text_1",
        type: "TEXT",
        x: 24,
        y: 24,
        width: 400,
        height: 64,
        zIndex: 1,
        text: "Ship faster",
        style: { fill: "#f2f4f7", fontSize: 40 },
      },
    ],
  };
}

const input = {
  graph: graph(),
  width: 512,
  height: 512,
  format: "PNG" as const,
  transparent: false,
  imageDataUrls: new Map<string, string>(),
};

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

function mockFetch(route: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => route(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["IMAGE_POLLINATIONS_BASE_URL"];
  delete process.env["IMAGE_POLLINATIONS_MODEL"];
  delete process.env["IMAGE_POLLINATIONS_TIMEOUT_MS"];
});

describe("pollinationsConfigFromEnv", () => {
  it("requires a base URL and accepts anonymous operation", () => {
    expect(pollinationsConfigFromEnv({})).toBeNull();
    expect(
      pollinationsConfigFromEnv({
        IMAGE_POLLINATIONS_BASE_URL: "https://image.pollinations.ai/",
      }),
    ).toEqual({
      baseUrl: "https://image.pollinations.ai",
      model: null,
      timeoutMs: 120_000,
    });
  });

  it("reads the model and timeout overrides", () => {
    expect(
      pollinationsConfigFromEnv({
        IMAGE_POLLINATIONS_BASE_URL: "https://pollinations.example.com",
        IMAGE_POLLINATIONS_MODEL: "flux",
        IMAGE_POLLINATIONS_TIMEOUT_MS: "9000",
      }),
    ).toEqual({
      baseUrl: "https://pollinations.example.com",
      model: "flux",
      timeoutMs: 9_000,
    });
  });
});

describe("Pollinations image provider", () => {
  it("requests the prompt path with the target size and normalizes the image", async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(new Uint8Array(await pngBytes()), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });

    const provider = createPollinationsImageProvider({
      baseUrl: "https://pollinations.example.com",
      model: "flux",
      timeoutMs: 5_000,
    });
    const result = await provider.generate(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("https://pollinations.example.com/prompt/");
    expect(url).toContain(encodeURIComponent("Ship faster").replace(/%20/g, "%20"));
    expect(url).toContain("width=512");
    expect(url).toContain("height=512");
    expect(url).toContain("model=flux");
    expect(url).toContain("nologo=true");
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.providerModel).toBe("flux");
    expect(result.providerVersion).toBe(POLLINATIONS_IMAGE_PROVIDER_VERSION);
    expect(result.mimeType).toBe("image/png");
  });

  it("surfaces an HTTP failure as an execution error", async () => {
    mockFetch(() => new Response("busy", { status: 429 }));
    const provider = createPollinationsImageProvider({
      baseUrl: "https://pollinations.example.com",
      model: null,
      timeoutMs: 5_000,
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      code: "IMAGE_GENERATION_FAILED",
      message: "Pollinations image provider (pollinations.example.com) download failed (HTTP 429)",
    });
  });

  it("rejects undecodable image bytes", async () => {
    mockFetch(
      () =>
        new Response(new Uint8Array(Buffer.from("not an image")), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const provider = createPollinationsImageProvider({
      baseUrl: "https://pollinations.example.com",
      model: null,
      timeoutMs: 5_000,
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      code: "IMAGE_GENERATION_FAILED",
    });
  });
});
