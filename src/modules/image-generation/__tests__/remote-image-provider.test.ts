import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { inspectImage } from "../artifact/image-metadata";
import { verifyGeneratedImage } from "../artifact/verify-image";
import type { GraphicDesignGraph } from "../domain/types";
import { getImageProvider } from "../providers/registry";
import {
  getRemoteImageProvider,
  imagePromptFromGraph,
  remoteImageConfigFromEnv,
  REMOTE_IMAGE_CONFIGURED_VERSION,
  REMOTE_IMAGE_PROVIDER_VERSION,
} from "../providers/remote-image-provider";

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

async function pngBase64(width = 64, height = 64, opaque = true): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: opaque
        ? { r: 20, g: 40, b: 60, alpha: 1 }
        : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  return buffer.toString("base64");
}

function imagesResponse(b64: string, model?: string): Response {
  return new Response(JSON.stringify({ created: 1, data: [{ b64_json: b64 }] }), {
    status: 200,
    headers: { "content-type": "application/json", ...(model ? { "x-model": model } : {}) },
  });
}

const config = {
  baseUrl: "https://images.example.com/v1",
  apiKey: "sk-image",
  model: "gpt-image-1",
  timeoutMs: 5_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["IMAGE_LLM_BASE_URL"];
  delete process.env["IMAGE_LLM_MODEL"];
});

describe("remoteImageConfigFromEnv", () => {
  it("requires a base URL and a model", () => {
    expect(remoteImageConfigFromEnv({})).toBeNull();
    expect(
      remoteImageConfigFromEnv({ IMAGE_LLM_BASE_URL: "https://x.example.com" }),
    ).toBeNull();
  });

  it("reads the endpoint and defaults the (long) image timeout", () => {
    expect(
      remoteImageConfigFromEnv({
        IMAGE_LLM_BASE_URL: "https://api.openai.com/v1/",
        IMAGE_LLM_MODEL: "gpt-image-1",
        IMAGE_LLM_API_KEY: "sk-test",
      }),
    ).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-image-1",
      timeoutMs: 120_000,
    });
  });
});

describe("unconfigured remote image provider", () => {
  it("keeps failing explicitly with the preserved version string", async () => {
    const provider = getRemoteImageProvider({});
    expect(provider.version).toBe(REMOTE_IMAGE_PROVIDER_VERSION);
    await expect(
      provider.generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_PROVIDER_UNAVAILABLE",
      status: 503,
    });
  });

  it("is what the registry resolves when no endpoint is configured", () => {
    expect(getImageProvider("REMOTE_IMAGE").version).toBe(
      REMOTE_IMAGE_PROVIDER_VERSION,
    );
  });
});

describe("imagePromptFromGraph", () => {
  it("is deterministic and draws only on the graph", () => {
    const graphValue = graph();
    const first = imagePromptFromGraph(graphValue);
    const second = imagePromptFromGraph(graphValue);
    expect(first).toBe(second);
    expect(first).toContain('"Ship faster"');
    expect(first).toContain("#f2f4f7");
    expect(first).toContain("#101828");
  });
});

describe("configured remote image provider", () => {
  it("requests a model-sized image and normalizes it to the recipe dimensions", async () => {
    const fetchMock = vi.fn(async () => imagesResponse(await pngBase64()));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: config.model,
      IMAGE_LLM_API_KEY: config.apiKey,
    });
    expect(provider.version).toBe(REMOTE_IMAGE_CONFIGURED_VERSION);

    const result = await provider.generate({
      graph: graph(),
      width: 400,
      height: 300,
      format: "PNG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://images.example.com/v1/images/generations");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer sk-image",
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-image-1");
    expect(body["n"]).toBe(1);
    expect(body["size"]).toBe("1536x1024");
    expect(body["background"]).toBeUndefined();
    expect(body["output_format"]).toBeUndefined();
    expect(String(body["prompt"])).toContain("Ship faster");

    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.mimeType).toBe("image/png");
    expect(result.format).toBe("PNG");
    expect(result.providerModel).toBe("gpt-image-1");
    expect(result.providerVersion).toBe(REMOTE_IMAGE_CONFIGURED_VERSION);

    const metadata = await inspectImage(result.bytes);
    await expect(
      verifyGeneratedImage({
        bytes: result.bytes,
        metadata,
        expected: { width: 400, height: 300, format: "PNG", transparent: false },
      }),
    ).resolves.toBeUndefined();
  });

  it("produces a transparent PNG that passes the worker's transparency gate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imagesResponse(await pngBase64(64, 64, false))),
    );

    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: config.model,
    });
    const result = await provider.generate({
      graph: graph({ background: { kind: "TRANSPARENT" } }),
      width: 320,
      height: 320,
      format: "PNG",
      transparent: true,
      imageDataUrls: new Map(),
    });

    const [, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["background"]).toBe("transparent");
    expect(body["size"]).toBe("1024x1024");

    const metadata = await inspectImage(result.bytes);
    await expect(
      verifyGeneratedImage({
        bytes: result.bytes,
        metadata,
        expected: { width: 320, height: 320, format: "PNG", transparent: true },
      }),
    ).resolves.toBeUndefined();
  });

  it("converts to JPEG at the exact requested dimensions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imagesResponse(await pngBase64())),
    );

    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: config.model,
    });
    const result = await provider.generate({
      graph: graph(),
      width: 300,
      height: 400,
      format: "JPEG",
      transparent: false,
      imageDataUrls: new Map(),
    });

    const [, init] = (vi.mocked(fetch).mock.calls[0] ?? []) as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["output_format"]).toBe("jpeg");
    expect(body["size"]).toBe("1024x1536");

    expect(result.mimeType).toBe("image/jpeg");
    const metadata = await inspectImage(result.bytes);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(400);
    await expect(
      verifyGeneratedImage({
        bytes: result.bytes,
        metadata,
        expected: { width: 300, height: 400, format: "JPEG", transparent: false },
      }),
    ).resolves.toBeUndefined();
  });

  it("maps provider HTTP failures to a sanitized execution error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "SECRET_ECHO" } }), {
            status: 401,
          }),
      ),
    );

    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: config.model,
    });
    try {
      await provider.generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      });
      expect.unreachable("expected an image execution error");
    } catch (error) {
      expect(error).toMatchObject({ code: "IMAGE_GENERATION_FAILED" });
      expect((error as Error).message).toContain("images.example.com");
      expect((error as Error).message).toContain("HTTP 401");
      expect((error as Error).message).not.toContain("SECRET_ECHO");
    }
  });

  it("rejects an empty payload and undecodable image data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }))),
    );
    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: config.model,
    });
    await expect(
      provider.generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toMatchObject({
      message: "Remote image provider returned no image data",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imagesResponse(Buffer.from("not an image").toString("base64"))),
    );
    await expect(
      provider.generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toMatchObject({
      message: "Remote image provider returned undecodable image data",
    });
  });

  it("downloads a https URL response from a DALL-E-style payload", async () => {
    const png = await pngBase64();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/images/generations")) {
        return new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example.com/out.png" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(Buffer.from(png, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: "dall-e-3",
    });
    const result = await provider.generate({
      graph: graph(),
      width: 400,
      height: 300,
      format: "PNG",
      transparent: false,
      imageDataUrls: new Map(),
    });
    expect(result.providerModel).toBe("dall-e-3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a non-https download URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ url: "http://cdn.example.com/out.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const provider = getRemoteImageProvider({
      IMAGE_LLM_BASE_URL: config.baseUrl,
      IMAGE_LLM_MODEL: "dall-e-3",
    });
    await expect(
      provider.generate({
        graph: graph(),
        width: 400,
        height: 300,
        format: "PNG",
        transparent: false,
        imageDataUrls: new Map(),
      }),
    ).rejects.toMatchObject({
      message: "Remote image provider returned a non-https download URL",
    });
  });
});
