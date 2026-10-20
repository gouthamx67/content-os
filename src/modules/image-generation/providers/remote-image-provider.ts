import sharp from "sharp";
import { llmEndpointLabel } from "../../../lib/llm-chat";
import { llmFetch, readBoundedJson } from "../../../lib/llm-http";
import type { GraphicDesignGraph } from "../domain/types";
import { ImageExecutionError, ImageGenerationError } from "../errors";
import type {
  ImageProviderAdapter,
  ProviderGenerationInput,
  ProviderGenerationResult,
} from "./provider";

/**
 * The remote image provider.
 *
 * It is the same adapter boundary the local renderer uses: the worker hands it
 * a frozen design graph and expects verified bytes back. What changes is where
 * the pixels come from — an OpenAI-compatible `POST {baseUrl}/images/generations`
 * call — and what that means for fidelity:
 *
 *   - The model is asked for artwork derived from the graph's text and palette.
 *     A diffusion model renders *approximate* lettering, so this provider's
 *     output is generative key art, not a typographic reproduction of the
 *     template. LOCAL_GRAPHIC remains the exact renderer.
 *   - Attached image sources (`imageDataUrls`) are not sent: the generations
 *     endpoint does not accept input images. A graph that depends on a product
 *     photo keeps its pixels only under LOCAL_GRAPHIC.
 *   - Output is normalized (resized) to the recipe's exact dimensions and
 *     format, and the worker's `verifyGeneratedImage` gate still runs, so a
 *     model that answers with the wrong shape cannot be stored as a success.
 *
 * Without configuration the unconfigured adapter stays in place and keeps
 * failing explicitly — the hole never pretends.
 */

export type RemoteImageConfig = {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

/** The version reported while no image endpoint is configured. */
export const REMOTE_IMAGE_PROVIDER_VERSION = "remote-image/unconfigured";

/** The version reported by the real adapter. */
export const REMOTE_IMAGE_CONFIGURED_VERSION = "remote-image/1";

/** Base64 JSON of a 1536px PNG can exceed the 4 MB chat ceiling. */
const IMAGE_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 120_000;

export function remoteImageConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RemoteImageConfig | null {
  const baseUrl = env["IMAGE_LLM_BASE_URL"]?.trim();
  const model = env["IMAGE_LLM_MODEL"]?.trim();
  if (!baseUrl || !model) return null;
  const timeoutRaw = Number.parseInt(env["IMAGE_LLM_TIMEOUT_MS"] ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: env["IMAGE_LLM_API_KEY"]?.trim() ?? null,
    model,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * The unconfigured adapter. Selecting REMOTE_IMAGE without an endpoint fails
 * with a typed 503 rather than pretending to generate.
 */
export const remoteImageProvider: ImageProviderAdapter = {
  provider: "REMOTE_IMAGE",
  version: REMOTE_IMAGE_PROVIDER_VERSION,
  async generate() {
    throw new ImageGenerationError(
      "IMAGE_PROVIDER_UNAVAILABLE",
      "The remote image provider is not configured",
      503,
    );
  },
};

/** The nearest size the OpenAI images API accepts for a requested aspect. */
function modelSizeFor(width: number, height: number): string {
  const aspect = width / Math.max(1, height);
  if (aspect >= 1.25) return "1536x1024";
  if (aspect <= 0.8) return "1024x1536";
  return "1024x1024";
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Derives the image prompt from the frozen design graph. Deterministic: the
 * same graph always yields the same prompt, and text outside the graph cannot
 * leak in.
 */
export function imagePromptFromGraph(graph: GraphicDesignGraph): string {
  const texts = graph.elements
    .filter((element) => element.type === "TEXT" && element.text?.trim())
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => element.text!.trim());

  const palette = [
    ...new Set(
      graph.elements
        .map((element) => element.style?.fill)
        .filter((fill): fill is string => Boolean(fill && HEX_COLOR.test(fill))),
    ),
  ].slice(0, 5);

  const background =
    graph.background.kind === "COLOR" ? graph.background.color : null;

  const parts = [
    "Professional marketing key art, clean modern composition, high quality.",
  ];
  if (texts.length > 0) {
    parts.push(
      `The artwork must feature this exact copy, spelled correctly: ${texts
        .map((text) => JSON.stringify(text))
        .join(", ")}.`,
    );
  }
  if (palette.length > 0) parts.push(`Color palette: ${palette.join(", ")}.`);
  if (background && HEX_COLOR.test(background)) {
    parts.push(`Background color: ${background}.`);
  }
  parts.push("No watermarks, no borders, no extra text.");
  return parts.join(" ");
}

type ImagesResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
};

export async function fetchImageBytes(
  url: string,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  label = "Remote image provider",
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  try {
    const response = await llmFetch(url, { signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageExecutionError(
        `${label} download failed (HTTP ${response.status})`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > IMAGE_RESPONSE_MAX_BYTES) {
      throw new ImageExecutionError(
        `${label} download was empty or oversized`,
      );
    }
    return buffer;
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageExecutionError(`${label} download failed`);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export async function normalizeImage(
  input: ProviderGenerationInput,
  raw: Buffer,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const pipeline = sharp(raw, { failOn: "error" }).resize({
    width: input.width,
    height: input.height,
    fit: "cover",
    position: "centre",
  });

  if (input.format === "JPEG") {
    const background =
      input.graph.background.kind === "COLOR"
        ? input.graph.background.color
        : "#ffffff";
    const { data, info } = await pipeline
      .flatten({ background })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  }

  const { data, info } = await pipeline
    .png()
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

export function createRemoteImageProvider(
  config: RemoteImageConfig,
): ImageProviderAdapter {
  const label = llmEndpointLabel(config.baseUrl);

  return {
    provider: "REMOTE_IMAGE",
    version: REMOTE_IMAGE_CONFIGURED_VERSION,

    async generate(
      input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      try {
        response = await llmFetch(`${config.baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey
              ? { authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: config.model,
            prompt: imagePromptFromGraph(input.graph),
            n: 1,
            size: modelSizeFor(input.width, input.height),
            ...(input.transparent ? { background: "transparent" } : {}),
            ...(input.format === "JPEG" ? { output_format: "jpeg" } : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        throw new ImageExecutionError(
          controller.signal.aborted
            ? `Remote image provider (${label}) timed out`
            : `Remote image provider (${label}) is unreachable`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageExecutionError(
          `Remote image provider (${label}) request failed (HTTP ${response.status})`,
        );
      }

      const payload = (await readBoundedJson(
        response,
        IMAGE_RESPONSE_MAX_BYTES,
      )) as ImagesResponse | null;
      const entry = payload?.data?.[0];

      let raw: Buffer | null = null;
      if (entry?.b64_json) {
        raw = Buffer.from(entry.b64_json, "base64");
      } else if (entry?.url) {
        // DALL-E style URL responses; the URL is minted by the configured
        // provider, not the user, and only https downloads are followed.
        let url: URL;
        try {
          url = new URL(entry.url);
        } catch {
          throw new ImageExecutionError(
            "Remote image provider returned an invalid download URL",
          );
        }
        if (url.protocol !== "https:") {
          throw new ImageExecutionError(
            "Remote image provider returned a non-https download URL",
          );
        }
        raw = await fetchImageBytes(entry.url, config.timeoutMs, undefined);
      }

      if (!raw || raw.byteLength === 0) {
        throw new ImageExecutionError(
          "Remote image provider returned no image data",
        );
      }

      let normalized: { bytes: Buffer; width: number; height: number };
      try {
        normalized = await normalizeImage(input, raw);
      } catch {
        throw new ImageExecutionError(
          "Remote image provider returned undecodable image data",
        );
      }
      const mimeType = input.format === "JPEG" ? "image/jpeg" : "image/png";

      return {
        bytes: normalized.bytes,
        width: normalized.width,
        height: normalized.height,
        mimeType,
        format: input.format,
        providerJobId: null,
        providerModel: config.model,
        providerVersion: REMOTE_IMAGE_CONFIGURED_VERSION,
      };
    },
  };
}

/**
 * Resolves the adapter for the current environment: the real provider when the
 * endpoint is configured, the explicit hole otherwise.
 */
export function getRemoteImageProvider(
  env: Record<string, string | undefined> = process.env,
): ImageProviderAdapter {
  const config = remoteImageConfigFromEnv(env);
  return config ? createRemoteImageProvider(config) : remoteImageProvider;
}
