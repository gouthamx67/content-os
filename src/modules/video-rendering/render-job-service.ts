import { createId } from "../../lib/id";
import { HttpError } from "../../lib/http";
import type { RenderJobRepository } from "../../core/ports/render-job-repository";
import type { RendererContract } from "../visual-motion-engine/export/renderer-contract";
import { assertWithinRenderLimits, validateRendererContract } from "./contract/validate-renderer-contract";
import { RENDER_OUTPUT } from "./render-limits";
import { hashScene } from "./serialization/hash-scene";
import { stableStringify } from "./serialization/stable-json";
import type { RenderArtifactRecord, RenderJobRecord } from "./domain/types";

export type RenderJobServiceDeps = {
  repository: RenderJobRepository;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  contractFor: (args: {
    projectId: string;
    compositionId: string;
    userId: string;
  }) => Promise<RendererContract>;
};

export type EnqueueRenderArgs = {
  projectId: string;
  compositionId: string;
  userId: string;
};

/**
 * Enqueues and reads render jobs.
 *
 * Enqueueing snapshots the renderer contract at that moment. A later edit to the
 * composition cannot change what a queued job produces, so the artifact always
 * matches the scene that was on screen when the user asked for it.
 */
export class RenderJobService {
  constructor(private readonly deps: RenderJobServiceDeps) {}

  async enqueue(args: EnqueueRenderArgs): Promise<RenderJobRecord> {
    const contract = await this.deps.contractFor(args);
    return this.enqueueContract(args.projectId, args.userId, contract);
  }

  /** Used by callers that already hold an authorized contract. */
  async enqueueContract(
    projectId: string,
    userId: string,
    contract: RendererContract,
  ): Promise<RenderJobRecord> {
    const validated = validateRendererContract(contract);
    assertWithinRenderLimits(validated);

    if (validated.composition.projectId !== projectId) {
      throw new HttpError(400, "Renderer contract does not belong to this project");
    }

    const now = new Date().toISOString();

    return this.deps.repository.create({
      id: createId("render"),
      projectId,
      compositionId: validated.composition.id,
      requestedById: userId,
      contractVersion: validated.contractVersion,
      sceneGraph: stableStringify(validated),
      sceneSha256: hashScene(validated),
      outputFormat: RENDER_OUTPUT.format,
      width: validated.composition.canvas.width,
      height: validated.composition.canvas.height,
      frameRate: validated.composition.canvas.frameRate,
      durationMs: validated.composition.canvas.durationMs,
      createdAt: now,
      updatedAt: now,
    });
  }

  async list(args: {
    projectId: string;
    userId: string;
    compositionId?: string;
    status?: RenderJobRecord["status"];
    limit?: number;
  }): Promise<RenderJobRecord[]> {
    await this.deps.authorizeProject(args.projectId, args.userId);
    return this.deps.repository.list(args.projectId, {
      compositionId: args.compositionId,
      status: args.status,
      limit: args.limit,
    });
  }

  async get(args: {
    projectId: string;
    renderJobId: string;
    userId: string;
  }): Promise<RenderJobRecord> {
    await this.deps.authorizeProject(args.projectId, args.userId);

    const job = await this.deps.repository.get(args.projectId, args.renderJobId);

    if (!job) {
      // A job in another project reads as missing rather than forbidden.
      throw new HttpError(404, "Render job not found");
    }

    return job;
  }

  async cancel(args: {
    projectId: string;
    renderJobId: string;
    userId: string;
  }): Promise<RenderJobRecord> {
    const existing = await this.get(args);
    const accepted = await this.deps.repository.requestCancel(
      args.projectId,
      args.renderJobId,
    );

    if (!accepted) {
      // The state changed underneath us: return the truth rather than claim a
      // cancellation that did not happen.
      return this.get(args);
    }

    const updated = await this.deps.repository.get(args.projectId, args.renderJobId);
    return updated ?? existing;
  }

  async artifact(args: {
    projectId: string;
    renderJobId: string;
    userId: string;
  }): Promise<RenderArtifactRecord | null> {
    await this.get(args);
    return this.deps.repository.getArtifactByJob(args.renderJobId);
  }
}
