import { llmEndpointLabel } from "../../../lib/llm-chat";
import { ImageExecutionError } from "../errors";
import type {
  ImageProviderAdapter,
  ProviderGenerationInput,
  ProviderGenerationResult,
} from "./provider";
import { fetchImageBytes, imagePromptFromGraph, normalizeImage } from "./remote-image-provider";

/**
 * Pollinations image provider.
 *
 * https://image.pollinations.ai is an open-source, keyless text-to-image
 * service: the prompt is part of the GET path and the response body is the
 * image itself. It is the last link in the REMOTE_IMAGE chain — a free,
 * community-funded fallback for when a paid endpoint is unavailable.
 *
 * The legacy prompt path is used deliberately: the newer OpenAI-shaped
 * endpoint requires a (free) account key, while this path answers anonymous
 * requests. No credentials are sent, so there is nothing to leak.
 */
export type PollinationsImageConfig = {
  baseUrl: string;
  model: string | null;
  timeoutMs: number;
};

export const POLLINATIONS_IMAGE_PROVIDER_VERSION =
  "remote-image/pollinations/1";

const DEFAULT_TIMEOUT_MS = 120_000;

export function pollinationsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PollinationsImageConfig | null {
  const baseUrl = env["IMAGE_POLLINATIONS_BASE_URL"]?.trim();
  if (!baseUrl) return null;
  const timeoutRaw = Number.parseInt(
    env["IMAGE_POLLINATIONS_TIMEOUT_MS"] ?? "",
    10,
  );
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env["IMAGE_POLLINATIONS_MODEL"]?.trim() || null,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
  };
}

export function createPollinationsImageProvider(
  config: PollinationsImageConfig,
): ImageProviderAdapter {
  const label = `Pollinations image provider (${llmEndpointLabel(config.baseUrl)})`;

  return {
    provider: "REMOTE_IMAGE",
    version: POLLINATIONS_IMAGE_PROVIDER_VERSION,

    async generate(
      input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
      const params = new URLSearchParams({
        width: String(input.width),
        height: String(input.height),
        nologo: "true",
        enhance: "false",
      });
      if (config.model) params.set("model", config.model);

      const url = `${config.baseUrl}/prompt/${encodeURIComponent(
        imagePromptFromGraph(input.graph),
      )}?${params.toString()}`;

      const raw = await fetchImageBytes(url, config.timeoutMs, undefined, label);
      if (raw.byteLength === 0) {
        throw new ImageExecutionError(`${label} returned no image data`);
      }

      let normalized: { bytes: Buffer; width: number; height: number };
      try {
        normalized = await normalizeImage(input, raw);
      } catch {
        throw new ImageExecutionError(
          `${label} returned undecodable image data`,
        );
      }

      return {
        bytes: normalized.bytes,
        width: normalized.width,
        height: normalized.height,
        mimeType: input.format === "JPEG" ? "image/jpeg" : "image/png",
        format: input.format,
        providerJobId: null,
        providerModel: config.model,
        providerVersion: POLLINATIONS_IMAGE_PROVIDER_VERSION,
      };
    },
  };
}
