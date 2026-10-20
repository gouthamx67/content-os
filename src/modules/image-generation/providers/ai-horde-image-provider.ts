import { llmEndpointLabel } from "../../../lib/llm-chat";
import { llmFetch, readBoundedJson } from "../../../lib/llm-http";
import { ImageExecutionError } from "../errors";
import type {
  ImageProviderAdapter,
  ProviderGenerationInput,
  ProviderGenerationResult,
} from "./provider";
import {
  fetchImageBytes,
  imagePromptFromGraph,
  normalizeImage,
} from "./remote-image-provider";

/**
 * AI Horde image provider.
 *
 * https://aihorde.net is open-source, community-run infrastructure: volunteers
 * donate GPU time and the queue is anonymous by default. The protocol is not
 * OpenAI-shaped — submit a job, poll it, then download the produced image — so
 * this adapter implements the same `ImageProviderAdapter` boundary rather than
 * pretending to be an `/images/generations` endpoint.
 *
 * It reports `provider: "REMOTE_IMAGE"` because that is the persisted enum the
 * worker already understands: the pixels still come from a remote model, and
 * the recipe/verification path is unchanged. The version string distinguishes
 * the transport.
 *
 * The anonymous key is public knowledge (AI Horde documents `0000000000`), so
 * no secret is required to run this. A registered key only improves queue
 * priority; it is read from `IMAGE_HORDE_API_KEY` when supplied.
 */

export type AiHordeConfig = {
  baseUrl: string;
  apiKey: string;
  model: string | null;
  steps: number;
  timeoutMs: number;
  pollIntervalMs: number;
};

export const AI_HORDE_PROVIDER_VERSION = "remote-image/ai-horde/1";

/** Horde's documented anonymous key; lowest queue priority, never a secret. */
export const AI_HORDE_ANONYMOUS_KEY = "0000000000";

const CLIENT_AGENT = "content-os:1.0";
const DEFAULT_BASE_URL = "https://aihorde.net";
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_STEPS = 20;
const STATUS_MAX_BYTES = 4 * 1024 * 1024;

export function aiHordeConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AiHordeConfig | null {
  const baseUrl = env["IMAGE_HORDE_BASE_URL"]?.trim();
  if (!baseUrl) return null;

  const timeoutRaw = Number.parseInt(env["IMAGE_HORDE_TIMEOUT_MS"] ?? "", 10);
  const pollRaw = Number.parseInt(env["IMAGE_HORDE_POLL_MS"] ?? "", 10);
  const stepsRaw = Number.parseInt(env["IMAGE_HORDE_STEPS"] ?? "", 10);

  return {
    baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey:
      env["IMAGE_HORDE_API_KEY"]?.trim() || AI_HORDE_ANONYMOUS_KEY,
    model: env["IMAGE_HORDE_MODEL"]?.trim() || null,
    steps:
      Number.isFinite(stepsRaw) && stepsRaw > 0
        ? Math.min(stepsRaw, 50)
        : DEFAULT_STEPS,
    timeoutMs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : DEFAULT_TIMEOUT_MS,
    pollIntervalMs:
      Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_INTERVAL_MS,
  };
}

/**
 * A generation size the volunteer fleet actually serves. Stable Diffusion
 * checkpoints on the horde work best in multiples of 64 at 512–1024 px; the
 * adapter then resizes to the recipe's exact dimensions, so the request only
 * has to preserve the aspect closely, not match it.
 */
export function hordeSizeFor(
  width: number,
  height: number,
): { width: number; height: number } {
  const aspect = width / Math.max(1, height);
  const large = Math.max(width, height) > 640;
  if (aspect >= 1.25) return large ? { width: 1024, height: 768 } : { width: 512, height: 384 };
  if (aspect <= 0.8) return large ? { width: 768, height: 1024 } : { width: 384, height: 512 };
  return large ? { width: 1024, height: 1024 } : { width: 512, height: 512 };
}

type AsyncResponse = { id?: string };
type CheckResponse = {
  done?: boolean;
  faulted?: boolean;
  is_possible?: boolean;
  wait_time?: number;
};
type StatusResponse = {
  generations?: Array<{ img?: string; model?: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAiHordeImageProvider(
  config: AiHordeConfig,
): ImageProviderAdapter {
  const label = llmEndpointLabel(config.baseUrl);

  return {
    provider: "REMOTE_IMAGE",
    version: AI_HORDE_PROVIDER_VERSION,

    async generate(
      input: ProviderGenerationInput,
    ): Promise<ProviderGenerationResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        apikey: config.apiKey,
        "client-agent": CLIENT_AGENT,
      };

      try {
        let submit: Response;
        try {
          submit = await llmFetch(`${config.baseUrl}/api/v2/generate/async`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              prompt: imagePromptFromGraph(input.graph),
              params: {
                ...hordeSizeFor(input.width, input.height),
                steps: config.steps,
                n: 1,
                ...(config.model ? { models: [config.model] } : {}),
              },
            }),
            signal: controller.signal,
          });
        } catch {
          throw new ImageExecutionError(
            controller.signal.aborted
              ? `AI Horde provider (${label}) timed out`
              : `AI Horde provider (${label}) is unreachable`,
          );
        }

        if (!submit.ok) {
          await submit.body?.cancel().catch(() => undefined);
          throw new ImageExecutionError(
            `AI Horde provider (${label}) request failed (HTTP ${submit.status})`,
          );
        }

        const submitted = (await readBoundedJson(submit)) as AsyncResponse | null;
        const jobId = submitted?.id;
        if (!jobId) {
          throw new ImageExecutionError(
            `AI Horde provider (${label}) returned no job id`,
          );
        }

        // Anonymous requests are lowest priority, so the wait is bounded by the
        // operator timeout rather than by an arbitrary attempt count.
        for (;;) {
          if (controller.signal.aborted) {
            throw new ImageExecutionError(
              `AI Horde provider (${label}) timed out`,
            );
          }

          let check: Response;
          try {
            check = await llmFetch(
              `${config.baseUrl}/api/v2/generate/check/${encodeURIComponent(jobId)}`,
              { headers, signal: controller.signal },
            );
          } catch {
            throw new ImageExecutionError(
              controller.signal.aborted
                ? `AI Horde provider (${label}) timed out`
                : `AI Horde provider (${label}) is unreachable`,
            );
          }

          if (!check.ok) {
            await check.body?.cancel().catch(() => undefined);
            throw new ImageExecutionError(
              `AI Horde provider (${label}) request failed (HTTP ${check.status})`,
            );
          }

          const state = (await readBoundedJson(check)) as CheckResponse | null;
          if (state?.faulted) {
            throw new ImageExecutionError(
              `AI Horde provider (${label}) reported the job as faulted`,
            );
          }
          if (state?.is_possible === false) {
            throw new ImageExecutionError(
              `AI Horde provider (${label}) has no worker for this request`,
            );
          }
          if (state?.done) break;

          await sleep(config.pollIntervalMs);
        }

        let status: Response;
        try {
          status = await llmFetch(
            `${config.baseUrl}/api/v2/generate/status/${encodeURIComponent(jobId)}`,
            { headers, signal: controller.signal },
          );
        } catch {
          throw new ImageExecutionError(
            controller.signal.aborted
              ? `AI Horde provider (${label}) timed out`
              : `AI Horde provider (${label}) is unreachable`,
          );
        }

        if (!status.ok) {
          await status.body?.cancel().catch(() => undefined);
          throw new ImageExecutionError(
            `AI Horde provider (${label}) request failed (HTTP ${status.status})`,
          );
        }

        const final = (await readBoundedJson(
          status,
          STATUS_MAX_BYTES,
        )) as StatusResponse | null;
        const generation = final?.generations?.[0];
        const imageUrl = generation?.img;

        if (!imageUrl) {
          throw new ImageExecutionError(
            `AI Horde provider (${label}) returned no image data`,
          );
        }

        let parsed: URL;
        try {
          parsed = new URL(imageUrl);
        } catch {
          throw new ImageExecutionError(
            "AI Horde provider returned an invalid download URL",
          );
        }
        if (parsed.protocol !== "https:") {
          throw new ImageExecutionError(
            "AI Horde provider returned a non-https download URL",
          );
        }

        const raw = await fetchImageBytes(
          imageUrl,
          config.timeoutMs,
          undefined,
          "AI Horde provider",
        );

        let normalized: { bytes: Buffer; width: number; height: number };
        try {
          normalized = await normalizeImage(input, raw);
        } catch {
          throw new ImageExecutionError(
            "AI Horde provider returned undecodable image data",
          );
        }

        return {
          bytes: normalized.bytes,
          width: normalized.width,
          height: normalized.height,
          mimeType: input.format === "JPEG" ? "image/jpeg" : "image/png",
          format: input.format,
          providerJobId: jobId,
          providerModel: generation?.model ?? config.model,
          providerVersion: AI_HORDE_PROVIDER_VERSION,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
