import { describe, expect, it, vi } from "vitest";
import { ImageCancelledError, ImageExecutionError, ImageGenerationError } from "../errors";
import {
  IMAGE_PROVIDER_CHAIN_VERSION,
  createImageProviderChain,
} from "../providers/image-provider-chain";
import type {
  ImageProviderAdapter,
  ProviderGenerationResult,
} from "../providers/provider";
import type { GraphicDesignGraph } from "../domain/types";

function graph(): GraphicDesignGraph {
  return {
    contractVersion: 1,
    width: 512,
    height: 512,
    background: { kind: "COLOR", color: "#101828" },
    elements: [],
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

function result(model: string): ProviderGenerationResult {
  return {
    bytes: Buffer.from(model),
    width: 512,
    height: 512,
    mimeType: "image/png",
    format: "PNG",
    providerJobId: null,
    providerModel: model,
    providerVersion: "test/1",
  };
}

function adapter(
  name: string,
  generate: ImageProviderAdapter["generate"],
): ImageProviderAdapter {
  return { provider: "REMOTE_IMAGE", version: `test/${name}`, generate };
}

describe("createImageProviderChain", () => {
  it("returns the only adapter unchanged", () => {
    const only = adapter("only", async () => result("only"));
    expect(createImageProviderChain([only])).toBe(only);
  });

  it("rejects an empty chain", () => {
    expect(() => createImageProviderChain([])).toThrow(
      "An image provider chain needs at least one adapter",
    );
  });

  it("stops at the first provider that succeeds", async () => {
    const second = vi.fn(async () => result("second"));
    const chain = createImageProviderChain([
      adapter("first", async () => result("first")),
      adapter("second", second),
    ]);

    const output = await chain.generate(input);
    expect(output.providerModel).toBe("first");
    expect(second).not.toHaveBeenCalled();
    expect(chain.version).toBe(IMAGE_PROVIDER_CHAIN_VERSION);
  });

  it("falls over when a provider fails to execute", async () => {
    const chain = createImageProviderChain([
      adapter("quota", async () => {
        throw new ImageExecutionError("Remote image provider (openai) request failed (HTTP 429)");
      }),
      adapter("horde", async () => result("horde")),
    ]);

    const output = await chain.generate(input);
    expect(output.providerModel).toBe("horde");
  });

  it("reports every failure when the whole chain is exhausted", async () => {
    const chain = createImageProviderChain([
      adapter("one", async () => {
        throw new ImageExecutionError("first failed");
      }),
      adapter("two", async () => {
        throw new ImageExecutionError("second failed");
      }),
    ]);

    await expect(chain.generate(input)).rejects.toMatchObject({
      code: "IMAGE_GENERATION_FAILED",
      message: "All image providers failed: first failed; second failed",
    });
  });

  it("does not mask request errors as failover", async () => {
    const second = vi.fn(async () => result("second"));
    const chain = createImageProviderChain([
      adapter("feature", async () => {
        throw new ImageGenerationError("IMAGE_INVALID_REQUEST", "bad request", 400);
      }),
      adapter("second", second),
    ]);

    await expect(chain.generate(input)).rejects.toMatchObject({
      code: "IMAGE_INVALID_REQUEST",
    });
    expect(second).not.toHaveBeenCalled();
  });

  it("does not start another provider after cancellation", async () => {
    const second = vi.fn(async () => result("second"));
    const chain = createImageProviderChain([
      adapter("cancelled", async () => {
        throw new ImageCancelledError();
      }),
      adapter("second", second),
    ]);

    await expect(chain.generate(input)).rejects.toBeInstanceOf(ImageCancelledError);
    expect(second).not.toHaveBeenCalled();
  });
});
