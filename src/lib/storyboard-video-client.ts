import type { StoryboardVideoPlan } from "../modules/visual-motion-engine/storyboard-video";

type RenderJob = {
  id: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCEL_REQUESTED"
    | "CANCELLED";
  progressPct: number;
  errorMessage: string | null;
};

type RenderArtifact = {
  downloadUrl: string;
};

export type StoryboardVideoProgress = {
  stage: "composition" | "layers" | "render" | "poll";
  message: string;
  progressPct?: number;
};

export type GenerateStoryboardVideoResult = {
  compositionId: string;
  renderJobId: string;
  downloadUrl: string;
};

class StoryboardVideoRequestError extends Error {}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new StoryboardVideoRequestError(
      payload.message ?? payload.error ?? `Request failed (${response.status})`,
    );
  }

  return payload as T;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a composition from a storyboard plan, adds its layers and keyframes,
 * renders it, and returns the download URL.
 *
 * Every step is a real API call against the same routes the editor uses. The
 * runner is separate from the component so the ordering and error handling can
 * be tested without a browser or timers.
 */
export async function generateStoryboardVideo(input: {
  projectId: string;
  plan: StoryboardVideoPlan;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  onProgress?: (progress: StoryboardVideoProgress) => void;
}): Promise<GenerateStoryboardVideoResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? 1_200;
  const base = `/api/projects/${input.projectId}/visual/compositions`;

  input.onProgress?.({
    stage: "composition",
    message: "Creating the video canvas",
  });

  const created = await requestJson<{
    composition: { id: string };
  }>(fetchImpl, base, {
    method: "POST",
    body: JSON.stringify(input.plan.composition),
  });
  const compositionId = created.composition.id;

  input.onProgress?.({
    stage: "layers",
    message: `Laying out ${input.plan.layers.length} layers`,
  });

  const keyframeJobs: Array<{
    layerId: string;
    keyframes: NonNullable<StoryboardVideoPlan["layers"][number]["keyframes"]>;
  }> = [];

  for (const layer of input.plan.layers) {
    const { keyframes, ...body } = layer;
    const added = await requestJson<{
      composition: { layers: Array<{ id: string }> };
    }>(fetchImpl, `${base}/${compositionId}/layers`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const layerId = added.composition.layers.at(-1)?.id;

    if (!layerId) {
      throw new StoryboardVideoRequestError(
        "The composition did not return the new layer",
      );
    }

    if (keyframes && keyframes.length > 0) {
      keyframeJobs.push({ layerId, keyframes });
    }
  }

  if (keyframeJobs.length > 0) {
    input.onProgress?.({
      stage: "layers",
      message: "Timing the scenes",
    });

    await Promise.all(
      keyframeJobs.flatMap(({ layerId, keyframes }) =>
        keyframes.map((keyframe) =>
          requestJson(fetchImpl, `${base}/${compositionId}/layers/${layerId}/keyframes`, {
            method: "POST",
            body: JSON.stringify(keyframe),
          }),
        ),
      ),
    );
  }

  input.onProgress?.({ stage: "render", message: "Starting the render" });

  const enqueued = await requestJson<{ renderJob: RenderJob }>(
    fetchImpl,
    `${base}/${compositionId}/render`,
    { method: "POST" },
  );

  let job = enqueued.renderJob;
  let artifact: RenderArtifact | null = null;
  let attempts = 0;

  while (true) {
    if (job.status === "SUCCEEDED") {
      if (artifact) break;
    } else if (job.status === "FAILED" || job.status === "CANCELLED") {
      throw new StoryboardVideoRequestError(
        job.errorMessage ?? `The render ${job.status.toLowerCase()}`,
      );
    }

    attempts += 1;
    if (attempts > 300) {
      throw new StoryboardVideoRequestError("The render timed out");
    }

    await sleep(pollIntervalMs);

    const polled = await requestJson<{
      renderJob: RenderJob;
      artifact: RenderArtifact | null;
    }>(fetchImpl, `/api/projects/${input.projectId}/renders/${job.id}`);

    job = polled.renderJob;
    artifact = polled.artifact;

    input.onProgress?.({
      stage: "poll",
      message: `Rendering ${job.progressPct}%`,
      progressPct: job.progressPct,
    });
  }

  return {
    compositionId,
    renderJobId: job.id,
    downloadUrl: artifact.downloadUrl,
  };
}

export { StoryboardVideoRequestError };
