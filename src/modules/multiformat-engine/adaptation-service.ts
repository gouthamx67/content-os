import { HttpError } from "../../lib/http";
import { createId } from "../../lib/id";
import type {
  CreateAdaptationJobInput,
  CreateAdaptationPlan,
  AdaptationRepository,
} from "../../core/ports/adaptation-repository";
import type { RenderJobService } from "../video-rendering/render-job-service";
import { fitCopy } from "./adapters/copy/fit-copy";
import { survivingClaims, validateCopyOutput } from "./adapters/copy/validate-copy";
import type {
  AdaptationBatchRecord,
  AdaptationJobRecord,
  AdaptationKind,
  AdaptationSourceType,
  FormatContract,
  SnapshotClaim,
} from "./domain/types";
import { NO_PLATFORM } from "./domain/types";
import { AdaptationError } from "./errors";
import { kindForSource, resolveTargetFormat } from "./formats/compatibility";
import { listFormatContracts } from "./formats/registry";
import { ADAPTATION_LIMITS } from "./limits";
import type { PlatformAuthority } from "./platform/platform-authority";
import {
  buildAdaptationRecipe,
  defaultStorageKeyFor,
} from "./recipe/build-recipe";
import { stableStringify } from "../video-rendering/serialization/stable-json";
import type { MultiFormatSourceResolver } from "./source/source-resolver";
import {
  hashSourceSnapshot,
  serializeSourceSnapshot,
} from "./source/source-snapshot";
import { verifySourceIntegrity } from "./source/verify-source-integrity";

export type CreateAdaptationBatchArgs = {
  projectId: string;
  userId: string;
  sourceType: AdaptationSourceType;
  sourceId: string;
  targets: readonly {
    formatId: string;
    platformId?: string | null;
  }[];
};

export type AdaptationBatchDetail = {
  batch: AdaptationBatchRecord;
  jobs: AdaptationJobRecord[];
};

export type FormatOption = {
  id: string;
  label: string;
  kind: AdaptationKind;
  platformSupported: boolean | null;
  dimensions: { width: number | null; height: number | null };
  maxCharacters: number | null;
  maxWords: number | null;
  transparent: boolean | null;
};

export type AdaptationServiceDeps = {
  repository: AdaptationRepository;
  sources: MultiFormatSourceResolver;
  platforms: PlatformAuthority;
  renderJobs?: Pick<RenderJobService, "cancel" | "artifact">;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
};

/**
 * Everything a user can ask CP19 for, and nothing they can ask it to do to a
 * canonical source.
 *
 * The service is where the request becomes a frozen batch: the source is
 * snapshotted, every target is resolved against the server's format registry and
 * CP09's platform authority, and every decision is written into the batch and its
 * jobs before anything runs. By the time a worker sees a job, the job already
 * knows what it is supposed to produce.
 */
export class AdaptationService {
  private readonly repository: AdaptationRepository;
  private readonly sources: MultiFormatSourceResolver;
  private readonly platforms: PlatformAuthority;
  private readonly renderJobs: AdaptationServiceDeps["renderJobs"];
  private readonly authorizeProject: AdaptationServiceDeps["authorizeProject"];

  constructor(deps: AdaptationServiceDeps) {
    this.repository = deps.repository;
    this.sources = deps.sources;
    this.platforms = deps.platforms;
    this.renderJobs = deps.renderJobs;
    this.authorizeProject = deps.authorizeProject;
  }

  async createBatch(
    args: CreateAdaptationBatchArgs,
  ): Promise<AdaptationBatchDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    if (!Array.isArray(args.targets) || args.targets.length === 0) {
      throw new AdaptationError(
        "ADAPTATION_NO_COMPATIBLE_TARGETS",
        "An adaptation needs at least one target format",
        422,
      );
    }

    if (args.targets.length > ADAPTATION_LIMITS.maxTargetsPerBatch) {
      throw new AdaptationError(
        "ADAPTATION_TARGET_COUNT_EXCEEDED",
        `At most ${ADAPTATION_LIMITS.maxTargetsPerBatch} targets can be requested at once`,
        422,
      );
    }

    const snapshot = await this.sources.resolve({
      projectId: args.projectId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
    });

    if (snapshot.sourceType !== args.sourceType) {
      throw new AdaptationError(
        "ADAPTATION_SOURCE_TYPE_UNSUPPORTED",
        `That source is a ${snapshot.sourceType}`,
        422,
      );
    }

    // The bytes have to still be the bytes that were snapshotted before a batch
    // exists, otherwise the first progress read would already be describing
    // something that changed underneath it.
    await verifySourceIntegrity({
      projectId: args.projectId,
      snapshot,
      readSourceBytes: (input) => this.sources.readSourceBytes(input),
    });

    const sourceSnapshot = serializeSourceSnapshot(snapshot);
    const sourceSha256 = hashSourceSnapshot(sourceSnapshot);

    if (sourceSnapshot.length > ADAPTATION_LIMITS.maxSnapshotCharacters) {
      throw new AdaptationError(
        "ADAPTATION_INVALID_REQUEST",
        "This source is too large to freeze into an adaptation",
        422,
      );
    }

    const kind = kindForSource(args.sourceType);
    const seen = new Set<string>();
    const planned: {
      format: FormatContract;
      platformId: string;
      platformIdInRecipe: string | null;
      provenanceSourceIds: string[];
      storageKey: string;
      recipe: string;
      recipeSha256: string;
    }[] = [];

    for (const target of args.targets) {
      const format = resolveTargetFormat({
        sourceType: args.sourceType,
        formatId: target.formatId,
      });

      const platformId = target.platformId?.trim() ?? "";
      const key = `${format.id}::${platformId}`;
      if (seen.has(key)) {
        throw new AdaptationError(
          "ADAPTATION_INVALID_REQUEST",
          `${format.id} was requested twice for the same platform`,
          422,
        );
      }
      seen.add(key);

      if (platformId) {
        // CP09 owns "can this platform carry this", and owns the display name.
        await this.platforms.assertSupported({
          projectId: args.projectId,
          platformId,
          kind,
        });
      }

      const provenanceSourceIds = collectProvenance(snapshot, format);

      const storageKey = defaultStorageKeyFor({
        projectId: args.projectId,
        snapshot,
        sourceId: args.sourceId,
        sourceSha256,
        format,
        platformId: platformId || null,
        provenanceSourceIds,
      });

      const { recipe, recipeSha256 } = buildAdaptationRecipe({
        projectId: args.projectId,
        snapshot,
        sourceId: args.sourceId,
        sourceSha256,
        format,
        platformId: platformId || null,
        provenanceSourceIds,
        outputStorageKey: storageKey,
      });

      planned.push({
        format,
        platformId,
        platformIdInRecipe: platformId || null,
        provenanceSourceIds,
        storageKey,
        recipe: stableStringify(recipe),
        recipeSha256,
      });
    }

    if (planned.length === 0) {
      throw new AdaptationError(
        "ADAPTATION_NO_COMPATIBLE_TARGETS",
        "No requested format can be produced from this source",
        422,
      );
    }

    const now = new Date().toISOString();
    const batchId = createId("abatch");

    const plan: CreateAdaptationPlan = {
      batch: {
        id: batchId,
        projectId: args.projectId,
        requestedById: args.userId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceSnapshot,
        sourceSha256,
        targetCount: planned.length,
        createdAt: now,
        updatedAt: now,
      },
      jobs: planned.map(
        (entry): CreateAdaptationJobInput => ({
          id: createId("ajob"),
          batchId,
          projectId: args.projectId,
          requestedById: args.userId,
          platformId: entry.platformId,
          formatId: entry.format.id,
          kind: entry.format.kind,
          recipe: entry.recipe,
          recipeSha256: entry.recipeSha256,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    };

    const batch = await this.repository.createBatchWithJobs(plan);
    const jobs = await this.repository.listJobs(batch.id);

    return { batch, jobs };
  }

  async getBatch(args: {
    projectId: string;
    userId: string;
    batchId: string;
  }): Promise<AdaptationBatchDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const batch = await this.repository.getBatch(args.projectId, args.batchId);
    if (!batch) {
      // A batch in another project reads as missing rather than forbidden.
      throw new AdaptationError(
        "ADAPTATION_BATCH_NOT_FOUND",
        "Adaptation batch not found",
        404,
      );
    }

    return { batch, jobs: await this.repository.listJobs(batch.id) };
  }

  async listBatches(args: {
    projectId: string;
    userId: string;
    limit?: number;
  }): Promise<AdaptationBatchRecord[]> {
    await this.authorizeProject(args.projectId, args.userId);
    return this.repository.listBatches(args.projectId, {
      limit: args.limit ?? 20,
    });
  }

  async getJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<AdaptationJobRecord> {
    await this.authorizeProject(args.projectId, args.userId);

    const job = await this.repository.getJob(args.projectId, args.jobId);
    if (!job) {
      throw new AdaptationError(
        "ADAPTATION_JOB_NOT_FOUND",
        "Adaptation job not found",
        404,
      );
    }

    return job;
  }

  /** The adapted caption, for the text-only view of a copy variant. */
  async getJobText(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<{ jobId: string; text: string }> {
    const job = await this.getJob(args);

    if (job.kind !== "COPY") {
      throw new AdaptationError(
        "ADAPTATION_OUTPUT_UNAVAILABLE",
        "This adaptation has no text output",
        409,
      );
    }

    if (job.status !== "SUCCEEDED" || job.outputText === null) {
      throw new AdaptationError(
        "ADAPTATION_OUTPUT_UNAVAILABLE",
        "This adaptation has not produced text yet",
        409,
      );
    }

    return { jobId: job.id, text: job.outputText };
  }

  /**
   * Stops a batch, and with it every job still open inside it.
   *
   * A video job parked on a CP15 render also gets that render cancelled: leaving
   * FFmpeg running for output nobody will ever see wastes a core for minutes.
   */
  async cancelBatch(args: {
    projectId: string;
    userId: string;
    batchId: string;
  }): Promise<AdaptationBatchDetail> {
    await this.authorizeProject(args.projectId, args.userId);

    const batch = await this.repository.getBatch(args.projectId, args.batchId);
    if (!batch) {
      throw new AdaptationError(
        "ADAPTATION_BATCH_NOT_FOUND",
        "Adaptation batch not found",
        404,
      );
    }

    const jobs = await this.repository.listJobs(batch.id);
    const now = new Date().toISOString();

    const updated = await this.repository.requestCancelBatch({
      projectId: args.projectId,
      batchId: batch.id,
      finishedAt: now,
    });

    if (!updated) {
      throw new AdaptationError(
        "ADAPTATION_BATCH_NOT_CANCELLABLE",
        "This adaptation batch has already finished",
        409,
      );
    }

    for (const job of jobs) {
      if (job.status === "WAITING_RENDER" && job.renderJobId) {
        await this.cancelLinkedRender(job);
      }
    }

    return {
      batch: updated,
      jobs: await this.repository.listJobs(batch.id),
    };
  }

  async cancelJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<AdaptationJobRecord> {
    await this.authorizeProject(args.projectId, args.userId);

    const job = await this.repository.getJob(args.projectId, args.jobId);
    if (!job) {
      throw new AdaptationError(
        "ADAPTATION_JOB_NOT_FOUND",
        "Adaptation job not found",
        404,
      );
    }

    const accepted = await this.repository.requestCancelJob({
      projectId: args.projectId,
      jobId: job.id,
      finishedAt: new Date().toISOString(),
    });

    if (!accepted) {
      throw new AdaptationError(
        "ADAPTATION_JOB_NOT_CANCELLABLE",
        "This adaptation job has already finished",
        409,
      );
    }

    if (job.status === "WAITING_RENDER") {
      await this.cancelLinkedRender(job);
    }

    await this.repository.refreshBatchStatus({
      batchId: job.batchId,
      updatedAt: new Date().toISOString(),
    });

    const fresh = await this.repository.getJob(args.projectId, job.id);
    if (!fresh) {
      throw new AdaptationError(
        "ADAPTATION_JOB_NOT_FOUND",
        "Adaptation job not found",
        404,
      );
    }

    return fresh;
  }

  /**
   * The formats a source of this kind can become, with CP09's verdict on the
   * chosen platform attached.
   *
   * Nothing here is authored for the client: the list is the server's registry,
   * filtered by what this source can produce.
   */
  async listFormats(args: {
    projectId: string;
    userId: string;
    kind?: AdaptationKind;
    platformId?: string | null;
  }): Promise<{ formats: FormatOption[]; platformName: string | null }> {
    await this.authorizeProject(args.projectId, args.userId);

    const platformId = args.platformId?.trim() ?? "";
    let platformSupported: boolean | null = null;
    let platformName: string | null = null;

    if (platformId && args.kind) {
      platformSupported = await this.supportsPlatform(args.projectId, platformId, args.kind);
      platformName = this.platforms.displayName(platformId);
    }

    const formats = listFormatContracts(args.kind).map((format) => ({
      id: format.id,
      label: format.label,
      kind: format.kind,
      platformSupported,
      dimensions: {
        width: format.image?.width ?? format.video?.width ?? null,
        height: format.image?.height ?? format.video?.height ?? null,
      },
      maxCharacters: format.copy?.maxCharacters ?? null,
      maxWords: format.copy?.maxWords ?? null,
      transparent: format.image?.alpha ?? null,
    }));

    return { formats, platformName };
  }

  private async supportsPlatform(
    projectId: string,
    platformId: string,
    kind: AdaptationKind,
  ): Promise<boolean> {
    try {
      await this.platforms.assertSupported({ projectId, platformId, kind });
      return true;
    } catch (error) {
      if (error instanceof HttpError || error instanceof AdaptationError) {
        return false;
      }
      throw error;
    }
  }

  private async cancelLinkedRender(job: AdaptationJobRecord): Promise<void> {
    if (!this.renderJobs || !job.renderJobId) return;

    try {
      await this.renderJobs.cancel({
        projectId: job.projectId,
        renderJobId: job.renderJobId,
        userId: job.requestedById,
      });
    } catch {
      // A render that already finished, or one CP15 no longer knows about, must
      // not stop the adaptation from being cancelled.
    }
  }
}

/**
 * The provenance a variant is allowed to carry at creation time.
 *
 * For copy it is the CP06 sources behind the claims that survive the format's
 * limit; for a raster or a re-render there is no new textual assertion to
 * support, so nothing is claimed.
 */
function collectProvenance(
  snapshot: { claims?: readonly SnapshotClaim[]; sourceType: string },
  format: FormatContract,
): string[] {
  if (format.kind !== "COPY" || !snapshot.claims) return [];

  const fitted = fitCopy({
    text: snapshot.claims.map((claim) => claim.text).join(" "),
    maxCharacters: format.copy?.maxCharacters ?? 1,
    maxWords: format.copy?.maxWords ?? 1,
  });

  const sourceText =
    snapshot.claims.length > 0
      ? snapshot.claims.map((claim) => claim.text).join(" ")
      : "";

  return survivingClaims({
    outputText: fitted.text || sourceText,
    claims: snapshot.claims,
  }).sourceIds;
}