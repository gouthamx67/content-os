import type {
  LocalizationJobPatch,
  LocalizationRepository,
} from "../../../core/ports/localization-repository";
import { LocalizationError } from "../errors";
import { canonicalizeLocale, directionFromLocale } from "../domain/locale";
import type { GlossaryEntry } from "../domain/glossary";
import { pinnedTerms } from "../domain/glossary";
import { assertEditable, assertTransition } from "../domain/state-machine";
import { evaluateReadiness } from "../domain/readiness";
import { validateSegments } from "../domain/validation";
import { assertProviderCoverage, parseProviderOutput } from "../domain/schema";
import type {
  LocalizationJobRecord,
  LocalizationRevisionKind,
  LocalizationSegment,
  LocalizationSnapshot,
  LocalizationSourceType,
  LocalizationStrategy,
  ProjectLocaleRecord,
  TextDirection,
} from "../domain/types";
import type { LocalizationProvider } from "../integrations/ports";
import { serializeLocalizationJson } from "../serialization/canonical";
import type { SourceExtractor } from "./source-extractor";
import type { LocalizationProviderRegistry } from "./localization-provider";
import type { MaterializationService } from "./materialization-service";
import { translationMemoryKey } from "./translation-memory";

export type LocalizationServiceDeps = {
  repository: LocalizationRepository;
  extractor: SourceExtractor;
  providers: LocalizationProviderRegistry;
  materialization: MaterializationService;
  authorizeProject: (projectId: string, userId: string) => Promise<void>;
  newId: (prefix: string) => string;
  now: () => string;
};

export type LocalizationDetail = {
  job: LocalizationJobRecord;
  snapshot: LocalizationSnapshot;
  revisionNumber: number;
};

export type CreateJobCommand = {
  sourceType: LocalizationSourceType;
  sourceId: string;
  targetLocale: string;
  strategy: LocalizationStrategy;
  sourceLocale?: string;
};

export type ReviewDecision = "APPROVE" | "REQUEST_CHANGES";

type SnapshotSeed = {
  sourceType: LocalizationSourceType;
  sourceId: string;
  sourceLocale: string;
  targetLocale: string;
  strategy: LocalizationStrategy;
  sourceRevision: string;
  sourceHash: string;
  provider: string | null;
  providerModel: string | null;
  segments: LocalizationSegment[];
  entries: readonly GlossaryEntry[];
  targetDirection: TextDirection;
};

type SourceChange = {
  sourceRevision: string;
  sourceHash: string;
};

export class LocalizationService {
  constructor(private readonly deps: LocalizationServiceDeps) {}

  // --------------------------------------------------------------- locales

  async listLocales(userId: string, projectId: string) {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listProjectLocales(projectId);
  }

  async addLocale(
    userId: string,
    projectId: string,
    input: {
      locale: string;
      label?: string;
      direction?: TextDirection;
      isSource?: boolean;
      isTarget?: boolean;
    },
  ): Promise<ProjectLocaleRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const locale = canonicalizeLocale(input.locale);

    const existing = await this.deps.repository.findProjectLocaleByCode(
      projectId,
      locale,
    );
    if (existing) {
      throw new LocalizationError(
        "LOCALE_ALREADY_CONFIGURED",
        `${locale} is already configured for this project`,
        { locale },
      );
    }

    return this.deps.repository.createProjectLocale({
      id: this.deps.newId("locale"),
      projectId,
      locale,
      label: input.label?.trim() || locale,
      direction: input.direction ?? directionFromLocale(locale) ?? "LTR",
      isSource: input.isSource ?? false,
      isTarget: input.isTarget ?? true,
      createdById: userId,
      now: this.deps.now(),
    });
  }

  async updateLocale(
    userId: string,
    projectId: string,
    localeId: string,
    patch: {
      label?: string;
      direction?: TextDirection;
      isSource?: boolean;
      isTarget?: boolean;
    },
  ): Promise<ProjectLocaleRecord> {
    await this.deps.authorizeProject(projectId, userId);
    const updated = await this.deps.repository.updateProjectLocale(projectId, {
      localeId,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
      ...(patch.isSource !== undefined ? { isSource: patch.isSource } : {}),
      ...(patch.isTarget !== undefined ? { isTarget: patch.isTarget } : {}),
      updatedAt: this.deps.now(),
    });
    if (!updated) {
      throw new LocalizationError("LOCALE_NOT_FOUND", "Locale not found", {
        localeId,
      });
    }
    return updated;
  }

  async removeLocale(userId: string, projectId: string, localeId: string) {
    await this.deps.authorizeProject(projectId, userId);
    const removed = await this.deps.repository.deleteProjectLocale(
      projectId,
      localeId,
    );
    if (!removed) {
      throw new LocalizationError("LOCALE_NOT_FOUND", "Locale not found", {
        localeId,
      });
    }
    return { removed: true };
  }

  // -------------------------------------------------------------- glossary

  async listGlossary(
    userId: string,
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
  ) {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listGlossary(
      projectId,
      canonicalizeLocale(sourceLocale),
      canonicalizeLocale(targetLocale),
    );
  }

  async addGlossaryTerm(
    userId: string,
    projectId: string,
    input: {
      sourceLocale: string;
      targetLocale: string;
      term: string;
      translation: string;
      doNotTranslate?: boolean;
    },
  ) {
    await this.deps.authorizeProject(projectId, userId);
    const term = input.term.trim();
    if (term.length === 0) {
      throw new LocalizationError(
        "LOCALIZATION_INVALID_INPUT",
        "A glossary term cannot be empty",
      );
    }
    return this.deps.repository.upsertGlossaryTerm({
      id: this.deps.newId("gloss"),
      projectId,
      sourceLocale: canonicalizeLocale(input.sourceLocale),
      targetLocale: canonicalizeLocale(input.targetLocale),
      term,
      translation: input.translation.trim(),
      doNotTranslate: input.doNotTranslate ?? false,
      createdById: userId,
      now: this.deps.now(),
    });
  }

  async removeGlossaryTerm(userId: string, projectId: string, termId: string) {
    await this.deps.authorizeProject(projectId, userId);
    const removed = await this.deps.repository.deleteGlossaryTerm(
      projectId,
      termId,
    );
    if (!removed) {
      throw new LocalizationError(
        "GLOSSARY_TERM_NOT_FOUND",
        "Glossary term not found",
        { termId },
      );
    }
    return { removed: true };
  }

  // ------------------------------------------------------------------ jobs

  async listJobs(userId: string, projectId: string) {
    await this.deps.authorizeProject(projectId, userId);
    return this.deps.repository.listJobs(projectId);
  }

  async createJob(
    userId: string,
    projectId: string,
    command: CreateJobCommand,
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);

    const targetLocale = canonicalizeLocale(command.targetLocale);
    const locales = await this.deps.repository.listProjectLocales(projectId);

    const target = locales.find((locale) => locale.locale === targetLocale);
    if (!target || !target.isTarget) {
      throw new LocalizationError(
        "LOCALE_NOT_TARGET",
        `${targetLocale} is not a configured target locale`,
        { targetLocale },
      );
    }

    const sourceLocale = command.sourceLocale
      ? canonicalizeLocale(command.sourceLocale)
      : (locales.find((locale) => locale.isSource)?.locale ?? null);
    if (!sourceLocale) {
      throw new LocalizationError(
        "LOCALE_NOT_SOURCE",
        "No source locale is configured for this project",
      );
    }
    if (sourceLocale === targetLocale) {
      throw new LocalizationError(
        "TARGET_LOCALE_MISMATCH",
        "The target locale must differ from the source locale",
      );
    }

    const extraction = await this.deps.extractor.extract({
      projectId,
      sourceType: command.sourceType,
      sourceId: command.sourceId,
      sourceLocale,
    });

    if (extraction.segments.length === 0) {
      throw new LocalizationError(
        "LOCALIZATION_NO_SEGMENTS",
        "The source has no localizable text",
        { sourceType: command.sourceType, sourceId: command.sourceId },
      );
    }

    const now = this.deps.now();
    const jobId = this.deps.newId("loc");
    const snapshot = this.buildSnapshot({
      sourceType: command.sourceType,
      sourceId: command.sourceId,
      sourceLocale,
      targetLocale,
      strategy: command.strategy,
      sourceRevision: extraction.sourceRevision,
      sourceHash: extraction.sourceHash,
      provider: null,
      providerModel: null,
      segments: extraction.segments,
      entries: [],
      targetDirection: target.direction,
    });

    const job = await this.deps.repository.createJob({
      id: jobId,
      projectId,
      sourceType: command.sourceType,
      sourceId: command.sourceId,
      sourceRevision: extraction.sourceRevision,
      sourceHash: extraction.sourceHash,
      sourceLocale,
      targetLocale,
      strategy: command.strategy,
      status: "READY_TO_LOCALIZE",
      provider: null,
      createdById: userId,
      now,
      firstRevision: {
        revisionId: this.deps.newId("lrev"),
        kind: "CREATE",
        snapshot,
        createdById: userId,
        createdAt: now,
      },
    });

    return { job, snapshot, revisionNumber: job.headRevisionNumber };
  }

  async getDetail(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    const snapshot = await this.requireSnapshot(job);
    return { job, snapshot, revisionNumber: job.headRevisionNumber };
  }

  async listHistory(
    userId: string,
    projectId: string,
    jobId: string,
    page: { limit: number; offset: number },
  ) {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    const [revisions, total] = await Promise.all([
      this.deps.repository.listRevisions({
        jobId: job.id,
        limit: page.limit,
        offset: page.offset,
      }),
      this.deps.repository.countRevisions(job.id),
    ]);
    return { revisions, total };
  }

  async process(
    userId: string,
    projectId: string,
    jobId: string,
    command: { expectedRevisionNumber: number; provider?: string },
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    this.assertExpected(job, command.expectedRevisionNumber);
    assertTransition(job.status, "PROCESSING");

    const providerName = command.provider ?? job.provider ?? "local-rules";
    const provider = this.resolveProvider(providerName);
    const head = await this.requireSnapshot(job);
    const entries = await this.glossaryEntries(
      projectId,
      job.sourceLocale,
      job.targetLocale,
    );
    const targetDirection = await this.targetDirection(projectId, job.targetLocale);
    const now = this.deps.now();

    await this.append(
      job,
      userId,
      command.expectedRevisionNumber,
      "PROCESSED",
      { ...head, provider: providerName },
      { status: "PROCESSING", provider: providerName },
      now,
    );

    let nextSegments: LocalizationSegment[];
    let providerModel: string | null = head.providerModel;
    try {
      const copies = head.segments.map((segment) => ({ ...segment }));
      const pending: LocalizationSegment[] = [];
      for (const segment of copies) {
        const memory = await this.deps.repository.lookupTranslationMemory(
          projectId,
          job.sourceLocale,
          job.targetLocale,
          translationMemoryKey(segment.sourceText),
        );
        if (memory) {
          segment.targetText = memory.targetText;
        } else {
          pending.push(segment);
        }
      }

      if (pending.length > 0) {
        const output = await provider.localize({
          strategy: job.strategy,
          sourceLocale: job.sourceLocale,
          targetLocale: job.targetLocale,
          segments: pending,
          glossary: entries,
        });
        providerModel = output.providerModel;
        const parsed = parseProviderOutput(output.segments);
        assertProviderCoverage(parsed, pending);
        const byId = new Map(
          parsed.map((entry) => [entry.segmentId, entry.targetText]),
        );
        for (const segment of pending) {
          const text = byId.get(segment.id);
          if (text !== undefined) segment.targetText = text;
        }
      }

      nextSegments = this.withPinnedTerms(copies, entries);
    } catch (error) {
      await this.markFailed(
        job,
        command.expectedRevisionNumber + 1,
        head,
        error,
        userId,
        now,
      );
      throw this.mapProviderError(error);
    }

    const snapshot = this.buildSnapshot({
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      strategy: job.strategy,
      sourceRevision: head.sourceRevision,
      sourceHash: head.sourceHash,
      provider: providerName,
      providerModel,
      segments: nextSegments,
      entries,
      targetDirection,
    });

    return this.append(
      job,
      userId,
      command.expectedRevisionNumber + 1,
      "PROCESSED",
      snapshot,
      { status: "NEEDS_REVIEW", provider: providerName },
      now,
    );
  }

  async validate(
    userId: string,
    projectId: string,
    jobId: string,
    expectedRevisionNumber: number,
  ): Promise<LocalizationDetail & { stale: boolean }> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    this.assertExpected(job, expectedRevisionNumber);
    const head = await this.requireSnapshot(job);

    const change = await this.detectSourceChange(job, head);
    if (change) {
      const stale = await this.markStale(
        job,
        userId,
        expectedRevisionNumber,
        change,
        head,
      );
      return { ...stale, stale: true };
    }

    const entries = await this.glossaryEntries(
      projectId,
      job.sourceLocale,
      job.targetLocale,
    );
    const targetDirection = await this.targetDirection(projectId, job.targetLocale);
    const snapshot = this.buildSnapshot({
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      strategy: job.strategy,
      sourceRevision: head.sourceRevision,
      sourceHash: head.sourceHash,
      provider: head.provider,
      providerModel: head.providerModel,
      segments: this.withPinnedTerms(head.segments, entries),
      entries,
      targetDirection,
    });

    const detail = await this.append(
      job,
      userId,
      expectedRevisionNumber,
      "VALIDATED",
      snapshot,
      {},
      this.deps.now(),
    );
    return { ...detail, stale: false };
  }

  async editSegment(
    userId: string,
    projectId: string,
    jobId: string,
    segmentId: string,
    expectedRevisionNumber: number,
    targetText: string,
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    this.assertExpected(job, expectedRevisionNumber);
    assertEditable(job.status);

    const head = await this.requireSnapshot(job);
    if (!head.segments.some((segment) => segment.id === segmentId)) {
      throw new LocalizationError(
        "LOCALIZATION_INVALID_INPUT",
        "That segment does not belong to this localization",
        { segmentId },
      );
    }

    const entries = await this.glossaryEntries(
      projectId,
      job.sourceLocale,
      job.targetLocale,
    );
    const targetDirection = await this.targetDirection(projectId, job.targetLocale);
    const segments = head.segments.map((segment) =>
      segment.id === segmentId ? { ...segment, targetText } : { ...segment },
    );

    const snapshot = this.buildSnapshot({
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      sourceLocale: job.sourceLocale,
      targetLocale: job.targetLocale,
      strategy: job.strategy,
      sourceRevision: head.sourceRevision,
      sourceHash: head.sourceHash,
      provider: head.provider,
      providerModel: head.providerModel,
      segments: this.withPinnedTerms(segments, entries),
      entries,
      targetDirection,
    });

    return this.append(
      job,
      userId,
      expectedRevisionNumber,
      "SEGMENT_EDITED",
      snapshot,
      {},
      this.deps.now(),
    );
  }

  async review(
    userId: string,
    projectId: string,
    jobId: string,
    command: { expectedRevisionNumber: number; decision: ReviewDecision },
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    this.assertExpected(job, command.expectedRevisionNumber);
    const head = await this.requireSnapshot(job);
    const now = this.deps.now();

    if (command.decision === "APPROVE") {
      assertTransition(job.status, "APPROVED");
      if (!head.readiness.ready) {
        throw new LocalizationError(
          "LOCALIZATION_NOT_READY",
          "The localization has blocking findings",
          {
            findings: head.readiness.findings.filter(
              (finding) => finding.severity === "ERROR",
            ),
          },
        );
      }
      return this.append(
        job,
        userId,
        command.expectedRevisionNumber,
        "APPROVED",
        head,
        {
          status: "APPROVED",
          approvalRevisionNumber: command.expectedRevisionNumber + 1,
          approvedById: userId,
          approvedAt: now,
        },
        now,
      );
    }

    assertTransition(job.status, "CHANGES_REQUESTED");
    return this.append(
      job,
      userId,
      command.expectedRevisionNumber,
      "CHANGES_REQUESTED",
      head,
      {
        status: "CHANGES_REQUESTED",
        approvalRevisionNumber: null,
        approvedById: null,
        approvedAt: null,
      },
      now,
    );
  }

  async apply(
    userId: string,
    projectId: string,
    jobId: string,
    command: { expectedRevisionNumber: number },
  ): Promise<LocalizationDetail> {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);
    this.assertExpected(job, command.expectedRevisionNumber);

    if (job.status !== "APPROVED") {
      throw new LocalizationError(
        "LOCALIZATION_NOT_APPROVED",
        "Only an approved localization can be applied",
        { status: job.status },
      );
    }

    const head = await this.requireSnapshot(job);
    const change = await this.detectSourceChange(job, head);
    if (change) {
      await this.markStale(job, userId, command.expectedRevisionNumber, change, head);
      throw new LocalizationError(
        "LOCALIZATION_APPROVAL_STALE",
        "The source changed since this localization was approved",
        { sourceRevision: change.sourceRevision },
      );
    }

    const now = this.deps.now();
    const detail = await this.append(
      job,
      userId,
      command.expectedRevisionNumber,
      "APPLIED",
      head,
      { status: "APPLIED", appliedAt: now },
      now,
    );

    await this.rememberTranslations(projectId, job, head, userId, now);
    return detail;
  }

  async exportArtifact(userId: string, projectId: string, jobId: string) {
    await this.deps.authorizeProject(projectId, userId);
    const job = await this.requireJob(projectId, jobId);

    if (job.status !== "APPLIED") {
      throw new LocalizationError(
        "LOCALIZATION_NOT_APPROVED",
        "Only an applied localization can be exported",
        { status: job.status },
      );
    }

    const snapshot = await this.requireSnapshot(job);
    const artifact = this.deps.materialization.build({
      job,
      snapshot,
      localizationRevision: job.headRevisionNumber,
      provenance: {
        provider: snapshot.provider ?? "unknown",
        providerModel: snapshot.providerModel,
      },
      generatedAt: job.appliedAt ?? job.updatedAt,
    });

    return { artifact, json: serializeLocalizationJson(artifact) };
  }

  // -------------------------------------------------------------- internals

  private buildSnapshot(seed: SnapshotSeed): LocalizationSnapshot {
    const findings = validateSegments(seed.segments, {
      entries: seed.entries,
      targetDirection: seed.targetDirection,
    });

    return {
      request: {
        sourceType: seed.sourceType,
        sourceId: seed.sourceId,
        sourceLocale: seed.sourceLocale,
        targetLocale: seed.targetLocale,
        strategy: seed.strategy,
      },
      sourceRevision: seed.sourceRevision,
      sourceHash: seed.sourceHash,
      provider: seed.provider,
      providerModel: seed.providerModel,
      segments: seed.segments,
      findings,
      readiness: evaluateReadiness(seed.segments, findings),
    };
  }

  private withPinnedTerms(
    segments: readonly LocalizationSegment[],
    entries: readonly GlossaryEntry[],
  ): LocalizationSegment[] {
    return segments.map((segment) => ({
      ...segment,
      glossary: pinnedTerms(segment.sourceText, entries),
    }));
  }

  private async requireJob(
    projectId: string,
    jobId: string,
  ): Promise<LocalizationJobRecord> {
    const job = await this.deps.repository.getJob(projectId, jobId);
    if (!job) {
      throw new LocalizationError(
        "LOCALIZATION_NOT_FOUND",
        "Localization job not found",
        { jobId },
      );
    }
    return job;
  }

  private async requireSnapshot(
    job: LocalizationJobRecord,
  ): Promise<LocalizationSnapshot> {
    const revision = await this.deps.repository.getRevisionByNumber(
      job.id,
      job.headRevisionNumber,
    );
    if (!revision) {
      throw new LocalizationError(
        "LOCALIZATION_NOT_FOUND",
        "The localization head revision is missing",
        { jobId: job.id },
      );
    }
    return revision.snapshot;
  }

  private assertExpected(job: LocalizationJobRecord, expected: number): void {
    if (job.headRevisionNumber !== expected) {
      throw new LocalizationError(
        "LOCALIZATION_REVISION_CONFLICT",
        "The localization changed since it was read",
        {
          expectedRevisionNumber: expected,
          actualRevisionNumber: job.headRevisionNumber,
        },
      );
    }
  }

  private resolveProvider(name: string): LocalizationProvider {
    try {
      return this.deps.providers.get(name);
    } catch {
      throw new LocalizationError(
        "LOCALIZATION_PROVIDER_UNAVAILABLE",
        `The localization provider ${name} is not available`,
        { provider: name },
      );
    }
  }

  private async glossaryEntries(
    projectId: string,
    sourceLocale: string,
    targetLocale: string,
  ): Promise<GlossaryEntry[]> {
    const terms = await this.deps.repository.listGlossary(
      projectId,
      sourceLocale,
      targetLocale,
    );
    return terms.map((term) => ({
      term: term.term,
      translation: term.translation,
      doNotTranslate: term.doNotTranslate,
    }));
  }

  private async targetDirection(
    projectId: string,
    targetLocale: string,
  ): Promise<TextDirection> {
    const locale = await this.deps.repository.findProjectLocaleByCode(
      projectId,
      targetLocale,
    );
    return locale?.direction ?? "LTR";
  }

  private mapProviderError(error: unknown): LocalizationError {
    if (error instanceof LocalizationError) return error;
    const message =
      error instanceof Error ? error.message : "The localization provider failed";
    return new LocalizationError(
      "LOCALIZATION_PROVIDER_UNAVAILABLE",
      message,
    );
  }

  private async append(
    job: LocalizationJobRecord,
    userId: string,
    expectedRevisionNumber: number,
    kind: LocalizationRevisionKind,
    snapshot: LocalizationSnapshot,
    jobPatch: LocalizationJobPatch,
    now: string,
  ): Promise<LocalizationDetail> {
    const result = await this.deps.repository.appendRevision({
      projectId: job.projectId,
      jobId: job.id,
      expectedRevisionNumber,
      revision: {
        revisionId: this.deps.newId("lrev"),
        kind,
        snapshot,
        createdById: userId,
        createdAt: now,
      },
      jobPatch,
      now,
    });

    if (!result.applied || !result.job) {
      throw new LocalizationError(
        "LOCALIZATION_REVISION_CONFLICT",
        "The localization changed since it was read",
        { jobId: job.id, expectedRevisionNumber },
      );
    }

    return {
      job: result.job,
      snapshot,
      revisionNumber: result.job.headRevisionNumber,
    };
  }

  private async markFailed(
    job: LocalizationJobRecord,
    expectedRevisionNumber: number,
    snapshot: LocalizationSnapshot,
    error: unknown,
    userId: string,
    now: string,
  ): Promise<void> {
    const code =
      error instanceof LocalizationError
        ? error.code
        : "LOCALIZATION_PROVIDER_UNAVAILABLE";
    const message = error instanceof Error ? error.message : "Localization failed";

    try {
      await this.deps.repository.appendRevision({
        projectId: job.projectId,
        jobId: job.id,
        expectedRevisionNumber,
        revision: {
          revisionId: this.deps.newId("lrev"),
          kind: "FAILED",
          snapshot,
          createdById: userId,
          createdAt: now,
        },
        jobPatch: { status: "FAILED", errorCode: code, errorMessage: message },
        now,
      });
    } catch {
      // Best effort: the caller still receives the original failure.
    }
  }

  private async detectSourceChange(
    job: LocalizationJobRecord,
    snapshot: LocalizationSnapshot,
  ): Promise<SourceChange | null> {
    try {
      const extraction = await this.deps.extractor.extract({
        projectId: job.projectId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        sourceLocale: job.sourceLocale,
      });
      const sameRevision = extraction.sourceRevision === snapshot.sourceRevision;
      const sameHash = extraction.sourceHash === snapshot.sourceHash;
      if (sameRevision && sameHash) return null;
      return {
        sourceRevision: extraction.sourceRevision,
        sourceHash: extraction.sourceHash,
      };
    } catch {
      return {
        sourceRevision: "unavailable",
        sourceHash: `missing:${job.sourceId}`,
      };
    }
  }

  private async markStale(
    job: LocalizationJobRecord,
    userId: string,
    expectedRevisionNumber: number,
    change: SourceChange,
    snapshot: LocalizationSnapshot,
  ): Promise<LocalizationDetail> {
    const next: LocalizationSnapshot = {
      ...snapshot,
      sourceRevision: change.sourceRevision,
      sourceHash: change.sourceHash,
    };

    return this.append(
      job,
      userId,
      expectedRevisionNumber,
      "MARKED_STALE",
      next,
      {
        status: "STALE",
        sourceRevision: change.sourceRevision,
        sourceHash: change.sourceHash,
        approvalRevisionNumber: null,
        approvedById: null,
        approvedAt: null,
      },
      this.deps.now(),
    );
  }

  private async rememberTranslations(
    projectId: string,
    job: LocalizationJobRecord,
    snapshot: LocalizationSnapshot,
    userId: string,
    now: string,
  ): Promise<void> {
    try {
      for (const segment of snapshot.segments) {
        if (segment.targetText === null) continue;
        await this.deps.repository.upsertTranslationMemory({
          id: this.deps.newId("tm"),
          projectId,
          sourceLocale: job.sourceLocale,
          targetLocale: job.targetLocale,
          sourceHash: translationMemoryKey(segment.sourceText),
          sourceText: segment.sourceText,
          targetText: segment.targetText,
          createdById: userId,
          now,
        });
      }
    } catch {
      // Translation memory is an optimization; a failure must not undo an apply.
    }
  }
}
